package studio.oxide.jdbc;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.Reader;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A JDK-only JDBC bridge for signed OxideStudio driver packages. It contains no
 * vendor driver itself: each package supplies checked classpath JARs and the
 * Host supplies its manifest-bound identity via a cleared environment.
 */
public final class DriverMain {
  // Keep each protocol response comfortably below the Host's 4 MiB line limit.
  // This is a defensive limit for unknown JDBC implementations, not a UI page
  // size: packages can later advertise a dialect-specific paging contract.
  private static final int MAX_RESULT_ROWS = 2_000;
  private static final int MAX_CELL_CHARACTERS = 8_192;
  private static final int MAX_RESULT_CHARACTERS = 3 * 1024 * 1024;
  // Source definitions share the framed protocol with query results. Leave
  // headroom below the Host's 4 MiB line limit.
  private static final int MAX_OBJECT_SOURCE_CHARACTERS = 3 * 1024 * 1024;
  private static final int QUERY_TIMEOUT_SECONDS = 55;
  private static final Map<String, Connection> CONNECTIONS = new ConcurrentHashMap<>();
  // A JDBC Connection is not generally safe for arbitrary concurrent work.
  // Only a currently executing Statement is exposed to the reader thread so
  // it can receive the protocol's bounded cancel request; connection-affecting
  // commands otherwise retain protocol order on one executor.
  private static final Map<String, Statement> RUNNING_QUERIES = new ConcurrentHashMap<>();
  // One sidecar belongs to one saved connection. Serialize query execution for
  // that connection while keeping stdin free to deliver Statement.cancel().
  private static final ExecutorService CONNECTION_EXECUTOR = Executors.newSingleThreadExecutor((task) -> {
    Thread worker = new Thread(task, "oxide-jdbc-query");
    worker.setDaemon(true);
    return worker;
  });

  public static void main(String[] args) throws Exception {
    try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
         PrintWriter output = new PrintWriter(System.out, true)) {
      for (String line; (line = input.readLine()) != null;) {
        long id = 0;
        try {
          Map<String, Object> request = object(Json.parse(line));
          id = number(request.get("id")).longValue();
          String method = text(request.get("method"));
          if (usesConnectionExecutor(method)) {
            final long requestId = id;
            CONNECTION_EXECUTOR.execute(() -> respond(output, requestId, request));
          } else {
            respond(output, id, request);
          }
        } catch (Exception error) {
          writeResponse(output, error(id, "JDBC_DRIVER_ERROR", safeMessage(error)));
        }
      }
    } finally {
      for (Connection connection : CONNECTIONS.values()) close(connection);
      RUNNING_QUERIES.clear();
      CONNECTION_EXECUTOR.shutdownNow();
    }
  }

  private static boolean usesConnectionExecutor(String method) {
    return switch (method) {
      case "connect", "disconnect", "ping", "serverVersion", "query", "metadata", "createDatabase" -> true;
      default -> false;
    };
  }

  private static void respond(PrintWriter output, long id, Map<String, Object> request) {
    try {
      writeResponse(output, ok(id, handle(request)));
    } catch (Exception error) {
      writeResponse(output, error(id, errorCode(text(request.get("method")), error), safeMessage(error)));
    }
  }

  private static void writeResponse(PrintWriter output, Map<String, Object> response) {
    synchronized (output) {
      output.println(Json.stringify(response));
    }
  }

  private static Map<String, Object> handle(Map<String, Object> request) throws Exception {
    String method = text(request.get("method"));
    Map<String, Object> params = object(request.get("params"));
    return switch (method) {
      case "handshake" -> value("handshake", handshake());
      case "connect" -> { connect(params); yield value("empty", null); }
      case "disconnect" -> { disconnect(params); yield value("empty", null); }
      case "ping" -> value("boolean", connection(params).isValid(5));
      case "serverVersion" -> value("serverVersion", serverVersion(connection(params)));
      case "query" -> value("query", List.of(query(params)));
      case "metadata" -> value("metadata", metadata(params));
      case "createDatabase" -> { createDatabase(params); yield value("empty", null); }
      case "cancel" -> value("boolean", cancel(params));
      case "shutdown" -> { for (Connection c : CONNECTIONS.values()) close(c); CONNECTIONS.clear(); yield value("empty", null); }
      default -> throw new IllegalArgumentException("Unsupported JDBC driver method: " + method);
    };
  }

  private static Map<String, Object> handshake() {
    Map<String, Object> capabilities = new LinkedHashMap<>();
    capabilities.put("metadata", true); capabilities.put("query", true); capabilities.put("cancellation", true);
    capabilities.put("transactions", false); capabilities.put("databaseScopedQueries", true); capabilities.put("databaseCreation", true);
    // Primary, imported and exported keys are part of the portable JDBC
    // DatabaseMetaData contract. Package capabilities still decide whether
    // Explorer exposes these nodes for a particular server family.
    capabilities.put("referencingForeignKeys", true); capabilities.put("objectSource", isOracleDriver()); capabilities.put("readOnlyEnforcement", false);
    capabilities.put("semanticSchemaMigration", false);
    Map<String, Object> value = new LinkedHashMap<>();
    value.put("protocolVersion", "1.0"); value.put("packageId", requiredEnv("OXIDE_DRIVER_PACKAGE_ID"));
    value.put("packageVersion", requiredEnv("OXIDE_DRIVER_PACKAGE_VERSION")); value.put("driverId", requiredEnv("OXIDE_DRIVER_ID"));
    value.put("capabilities", capabilities); return value;
  }

  /**
   * Rust's tagged DriverRequest enum serializes its variant fields with their
   * wire names (snake_case). Keep camelCase as a temporary compatibility
   * fallback for pre-runner fixture clients, but never require it from the
   * desktop Host.
   */
  private static Object protocolField(Map<String, Object> params, String wireName, String legacyName) {
    return params.containsKey(wireName) ? params.get(wireName) : params.get(legacyName);
  }

  private static String connectionId(Map<String, Object> params) {
    return text(protocolField(params, "connection_id", "connectionId"));
  }

  private static void connect(Map<String, Object> params) throws SQLException {
    String id = connectionId(params); Map<String, Object> config = object(params.get("config"));
    Connection replacement = DriverManager.getConnection(text(config.get("url")));
    Connection previous = CONNECTIONS.put(id, replacement); close(previous);
  }
  private static void disconnect(Map<String, Object> params) { close(CONNECTIONS.remove(connectionId(params))); }
  private static Connection connection(Map<String, Object> params) {
    Connection value = CONNECTIONS.get(connectionId(params));
    if (value == null) throw new IllegalArgumentException("Connection is not open"); return value;
  }
  private static String serverVersion(Connection connection) throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData(); return metadata.getDatabaseProductVersion();
  }

  private static void createDatabase(Map<String, Object> params) throws SQLException {
    Connection connection = connection(params); Map<String, Object> request = object(params.get("request"));
    String name = text(request.get("name")); String kind = nullable(request.get("namespaceKind"));
    if (name.isBlank() || name.length() > 256) throw new IllegalArgumentException("Namespace name is invalid");
    if (nonBlank(request.get("charset")) || nonBlank(request.get("collation")) || nonBlank(request.get("owner"))) {
      throw new IllegalArgumentException("The generic JDBC Agent does not support charset, collation, or owner during namespace creation");
    }
    String statement = switch (kind == null ? "" : kind.toLowerCase(java.util.Locale.ROOT)) {
      case "schema" -> "CREATE SCHEMA " + quotedIdentifier(connection.getMetaData(), name);
      case "database" -> "CREATE DATABASE " + quotedIdentifier(connection.getMetaData(), name);
      default -> throw new IllegalArgumentException("The signed driver package must declare schema or database namespace creation");
    };
    try (Statement command = connection.createStatement()) {
      try { command.setQueryTimeout(QUERY_TIMEOUT_SECONDS); } catch (SQLException ignored) {}
      command.execute(statement);
    }
  }

  private static boolean nonBlank(Object value) { return value != null && !String.valueOf(value).isBlank(); }
  private static String quotedIdentifier(DatabaseMetaData metadata, String value) throws SQLException {
    String quote = metadata.getIdentifierQuoteString(); if (quote == null || quote.isBlank()) quote = "\"";
    if ("[".equals(quote)) return "[" + value.replace("]", "]]" ) + "]";
    return quote + value.replace(quote, quote + quote) + quote;
  }

  private static boolean cancel(Map<String, Object> params) {
    String connectionId = connectionId(params);
    String queryId = text(protocolField(params, "query_id", "queryId"));
    Statement statement = RUNNING_QUERIES.get(queryKey(connectionId, queryId));
    if (statement == null) return false;
    try {
      statement.cancel();
      return true;
    } catch (SQLException ignored) {
      return false;
    }
  }

  private static String queryKey(String connectionId, String queryId) {
    return connectionId + "\u0000" + queryId;
  }

  private static Map<String, Object> query(Map<String, Object> params) throws SQLException {
    String connectionId = connectionId(params); Connection connection = connection(params); String sql = text(params.get("statement"));
    List<Object> values = array(params.get("parameters"));
    String queryId = nullable(protocolField(params, "query_id", "queryId"));
    Map<String, Object> context = object(params.get("context"));
    try (QueryContext ignored = QueryContext.apply(connectionId, connection, context);
         PreparedStatement statement = connection.prepareStatement(sql)) {
      configureQueryStatement(statement);
      for (int index = 0; index < values.size(); index++) {
        Map<String, Object> parameter = object(values.get(index)); statement.setObject(index + 1, parameter.get("value"));
      }
      String runningKey = queryId == null || queryId.isBlank() ? null : queryKey(connectionId, queryId);
      if (runningKey != null) RUNNING_QUERIES.put(runningKey, statement);
      try {
        boolean hasRows = statement.execute();
        if (hasRows) try (ResultSet result = statement.getResultSet()) { return rows(result, sql); }
        Map<String, Object> result = emptyQuery(sql); result.put("rowsAffected", statement.getUpdateCount() < 0 ? null : statement.getUpdateCount()); return result;
      } finally {
        if (runningKey != null) RUNNING_QUERIES.remove(runningKey, statement);
      }
    }
  }

  /**
   * Apply the Host's immutable database/schema target to one query and restore
   * the connection before it can serve the next request. JDBC permits drivers
   * to ignore setCatalog/setSchema, so every change is read back. If applying
   * or restoring a context cannot be proven, the connection is removed and
   * closed instead of allowing a later query to run against an unknown target.
   */
  private static final class QueryContext implements AutoCloseable {
    private final String connectionId;
    private final Connection connection;
    private JdbcValue originalCatalog;
    private JdbcValue originalSchema;
    private boolean catalogTouched;
    private boolean schemaTouched;
    private boolean closed;

    private QueryContext(String connectionId, Connection connection) {
      this.connectionId = connectionId;
      this.connection = connection;
    }

    static QueryContext apply(String connectionId, Connection connection, Map<String, Object> context) throws SQLException {
      QueryContext scope = new QueryContext(connectionId, connection);
      try {
        String database = contextName(context.get("database"), "database");
        String schema = contextName(context.get("schema"), "schema");
        if (database != null) scope.applyCatalog(database);
        if (schema != null) scope.applySchema(schema, database == null);
        return scope;
      } catch (SQLException error) {
        try {
          scope.close();
        } catch (SQLException restoreError) {
          error.addSuppressed(restoreError);
        }
        throw error;
      }
    }

    private void applyCatalog(String requested) throws SQLException {
      originalCatalog = readCatalog(connection);
      if (!originalCatalog.supported) {
        throw new SQLException("The JDBC driver cannot prove database-scoped query support");
      }
      if (sameContext(originalCatalog.value, requested)) return;
      catalogTouched = true;
      setCatalog(connection, requested);
      JdbcValue applied = readCatalog(connection);
      if (!applied.supported || !sameContext(applied.value, requested)) {
        throw new SQLException("The JDBC driver did not apply the requested database context");
      }
    }

    private void applySchema(String requested, boolean allowCatalogFallback) throws SQLException {
      originalSchema = readSchema(connection);
      if (originalSchema.supported) {
        if (sameContext(originalSchema.value, requested)) return;
        schemaTouched = true;
        setSchema(connection, requested);
        JdbcValue applied = readSchema(connection);
        if (!applied.supported || !sameContext(applied.value, requested)) {
          throw new SQLException("The JDBC driver did not apply the requested schema context");
        }
        return;
      }
      if (!allowCatalogFallback) {
        throw new SQLException("The JDBC driver cannot apply a schema within the requested database context");
      }
      // MySQL-family JDBC drivers commonly model a schema as a catalog. Only
      // use this fallback when no separate database was requested; otherwise
      // it could replace the already selected SQL Server-style catalog.
      applyCatalog(requested);
    }

    @Override
    public void close() throws SQLException {
      if (closed) return;
      closed = true;
      SQLException failure = null;
      if (catalogTouched) {
        try {
          restoreCatalog();
        } catch (SQLException error) {
          failure = error;
        }
      }
      if (schemaTouched) {
        try {
          restoreSchema();
        } catch (SQLException error) {
          if (failure == null) failure = error; else failure.addSuppressed(error);
        }
      }
      if (failure != null) {
        CONNECTIONS.remove(connectionId, connection);
        DriverMain.close(connection);
        throw new SQLException("The JDBC query context could not be restored; the connection was closed", failure);
      }
    }

    private void restoreCatalog() throws SQLException {
      setCatalog(connection, originalCatalog.value);
      JdbcValue restored = readCatalog(connection);
      if (!restored.supported || !sameContext(restored.value, originalCatalog.value)) {
        throw new SQLException("The JDBC database context could not be restored");
      }
    }

    private void restoreSchema() throws SQLException {
      setSchema(connection, originalSchema.value);
      JdbcValue restored = readSchema(connection);
      if (!restored.supported || !sameContext(restored.value, originalSchema.value)) {
        throw new SQLException("The JDBC schema context could not be restored");
      }
    }
  }

  private static final class JdbcValue {
    private final boolean supported;
    private final String value;

    private JdbcValue(boolean supported, String value) {
      this.supported = supported;
      this.value = value;
    }
  }

  private static JdbcValue readCatalog(Connection connection) throws SQLException {
    try {
      return new JdbcValue(true, connection.getCatalog());
    } catch (SQLFeatureNotSupportedException | UnsupportedOperationException | AbstractMethodError ignored) {
      return new JdbcValue(false, null);
    }
  }

  private static JdbcValue readSchema(Connection connection) throws SQLException {
    try {
      return new JdbcValue(true, connection.getSchema());
    } catch (SQLFeatureNotSupportedException | UnsupportedOperationException | AbstractMethodError ignored) {
      return new JdbcValue(false, null);
    }
  }

  private static void setCatalog(Connection connection, String catalog) throws SQLException {
    try {
      connection.setCatalog(catalog);
    } catch (SQLFeatureNotSupportedException | UnsupportedOperationException | AbstractMethodError error) {
      throw new SQLException("The JDBC driver does not support database-scoped queries", error);
    }
  }

  private static void setSchema(Connection connection, String schema) throws SQLException {
    try {
      connection.setSchema(schema);
    } catch (SQLFeatureNotSupportedException | UnsupportedOperationException | AbstractMethodError error) {
      throw new SQLException("The JDBC driver does not support schema-scoped queries", error);
    }
  }

  private static String contextName(Object value, String label) throws SQLException {
    if (value == null) return null;
    String name = String.valueOf(value);
    if (name.isBlank() || name.length() > 256 || name.codePoints().anyMatch(Character::isISOControl)) {
      throw new SQLException("The requested JDBC " + label + " context is invalid");
    }
    return name;
  }

  private static boolean sameContext(String actual, String expected) {
    return actual == null ? expected == null : actual.equals(expected);
  }

  private static void configureQueryStatement(PreparedStatement statement) {
    try { statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS); } catch (SQLException ignored) {}
    try { statement.setFetchSize(250); } catch (SQLException ignored) {}
    // Ask compliant drivers for one sentinel row. The loop below also applies
    // the bound itself because JDBC drivers are allowed to ignore this hint.
    try { statement.setMaxRows(MAX_RESULT_ROWS + 1); } catch (SQLException ignored) {}
  }

  private static Object metadata(Map<String, Object> params) throws SQLException {
    Connection connection = connection(params); Map<String, Object> request = object(params.get("request")); String kind = text(request.get("kind"));
    DatabaseMetaData metadata = connection.getMetaData();
    return switch (kind) {
      case "databases" -> strings(metadata.getCatalogs(), "TABLE_CAT");
      // JDBC metadata may expose the same schema name under multiple
      // catalogs (for example SQL Server and DB2). Preserve the optional
      // protocol database context here, just as relation/column/index
      // discovery does below, so Explorer never merges objects from a
      // different selected catalog.
      case "schemas" -> strings(metadata.getSchemas(nullable(request.get("database")), null), "TABLE_SCHEM");
      case "relations" -> relations(metadata, nullable(request.get("database")), text(request.get("namespace")));
      case "columns" -> columns(metadata, nullable(request.get("database")), text(request.get("namespace")), text(request.get("relation")));
      case "indexes" -> indexes(metadata, nullable(request.get("database")), text(request.get("namespace")), text(request.get("relation")));
      case "constraints" -> constraints(metadata, nullable(request.get("database")), text(request.get("namespace")), text(request.get("relation")));
      case "referencingForeignKeys" -> referencingForeignKeys(metadata, nullable(request.get("database")), text(request.get("namespace")), text(request.get("relation")));
      case "routines" -> routines(metadata, nullable(request.get("database")), text(request.get("namespace")));
      case "objectSource" -> objectSource(connection, request);
      case "collections" -> List.of();
      default -> throw new IllegalArgumentException("Unsupported JDBC metadata request: " + kind);
    };
  }

  /**
   * Oracle exposes object definitions through DBMS_METADATA and the ALL_*
   * catalog views rather than portable JDBC metadata. Keep this identity-gated
   * and type-whitelisted in the signed JDBC process: the Host never
   * synthesizes vendor catalog SQL and every other JDBC product continues to
   * return no source.
   */
  private static List<Object> objectSource(Connection connection, Map<String, Object> request) throws SQLException {
    if (!isOracleDriver()) return List.of();
    String normalizedType = oracleObjectType(text(request.get("object_type")));
    String schema = metadataIdentifier(request.get("namespace"), "schema");
    String name = metadataIdentifier(request.get("object_name"), "object name");
    if ("VIEW".equals(normalizedType)) return oracleViewSource(connection, schema, name);
    String metadataType = oracleMetadataObjectType(normalizedType);
    if (metadataType != null) return oracleMetadataSource(connection, metadataType, schema, name);
    String sourceType = oracleStoredSourceType(normalizedType);
    return sourceType == null ? List.of() : oracleStoredSource(connection, sourceType, schema, name);
  }

  private static List<Object> oracleMetadataSource(Connection connection, String objectType, String schema, String name) throws SQLException {
    String sql = "SELECT DBMS_METADATA.GET_DDL(?, ?, ?) FROM DUAL";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      configureQueryStatement(statement);
      statement.setString(1, objectType);
      statement.setString(2, name);
      statement.setString(3, schema);
      try (ResultSet rows = statement.executeQuery()) {
        if (!rows.next()) return List.of();
        String source = boundedObjectSource(rows, 1);
        return source == null || source.isBlank() ? List.of() : List.of(source);
      }
    }
  }

  private static List<Object> oracleViewSource(Connection connection, String schema, String name) throws SQLException {
    SQLException metadataError = null;
    try {
      List<Object> source = oracleMetadataSource(connection, "VIEW", schema, name);
      if (!source.isEmpty()) return source;
    } catch (SQLException error) {
      metadataError = error;
    }
    try (PreparedStatement statement = connection.prepareStatement("SELECT TEXT FROM ALL_VIEWS WHERE OWNER = ? AND VIEW_NAME = ?")) {
      configureQueryStatement(statement);
      statement.setString(1, schema);
      statement.setString(2, name);
      try (ResultSet rows = statement.executeQuery()) {
        if (!rows.next()) return List.of();
        String source = boundedObjectSource(rows, 1);
        return source == null || source.isBlank() ? List.of() : List.of(source);
      }
    } catch (SQLException fallbackError) {
      if (metadataError != null) fallbackError.addSuppressed(metadataError);
      throw fallbackError;
    }
  }

  private static List<Object> oracleStoredSource(Connection connection, String objectType, String schema, String name) throws SQLException {
    String sql = "SELECT TEXT FROM ALL_SOURCE WHERE OWNER = ? AND NAME = ? AND TYPE = ? ORDER BY LINE";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      configureQueryStatement(statement);
      statement.setString(1, schema);
      statement.setString(2, name);
      statement.setString(3, objectType);
      try (ResultSet rows = statement.executeQuery()) {
        StringBuilder source = new StringBuilder();
        while (rows.next()) {
          String line = boundedObjectSource(rows, 1, MAX_OBJECT_SOURCE_CHARACTERS - source.length());
          if (line != null) source.append(line);
        }
        return source.length() == 0 ? List.of() : List.of(source.toString());
      }
    }
  }

  private static boolean isOracleDriver() { return "oracle".equalsIgnoreCase(System.getenv("OXIDE_DRIVER_ID")); }

  private static String oracleObjectType(String objectType) {
    if (objectType == null) return null;
    return objectType.trim().toUpperCase(java.util.Locale.ROOT).replace(' ', '_');
  }

  private static String oracleMetadataObjectType(String normalizedType) {
    if (normalizedType == null) return null;
    return switch (normalizedType) {
      case "TABLE", "MATERIALIZED_VIEW", "SEQUENCE", "SYNONYM" -> normalizedType;
      default -> null;
    };
  }

  private static String oracleStoredSourceType(String normalizedType) {
    if (normalizedType == null) return null;
    return switch (normalizedType) {
      case "FUNCTION", "PROCEDURE", "TRIGGER", "PACKAGE", "PACKAGE_BODY", "TYPE", "TYPE_BODY" -> normalizedType.replace('_', ' ');
      default -> null;
    };
  }

  private static String metadataIdentifier(Object value, String label) throws SQLException {
    String identifier = value == null ? "" : String.valueOf(value).trim();
    if (identifier.isEmpty() || identifier.length() > 256 || identifier.codePoints().anyMatch(Character::isISOControl)) {
      throw new SQLException("The requested JDBC " + label + " is invalid");
    }
    return identifier;
  }

  private static String boundedObjectSource(ResultSet rows, int index) throws SQLException {
    return boundedObjectSource(rows, index, MAX_OBJECT_SOURCE_CHARACTERS);
  }

  private static String boundedObjectSource(ResultSet rows, int index, int maximumCharacters) throws SQLException {
    if (maximumCharacters < 0) throw new SQLException("The JDBC object source exceeds the 3 MiB safety limit");
    try (Reader reader = rows.getCharacterStream(index)) {
      if (reader == null) return null;
      StringBuilder source = new StringBuilder(); char[] chunk = new char[8_192]; int read;
      try {
        while ((read = reader.read(chunk)) >= 0) {
          if (source.length() + read > maximumCharacters) throw new SQLException("The JDBC object source exceeds the 3 MiB safety limit");
          source.append(chunk, 0, read);
        }
      } catch (IOException error) {
        throw new SQLException("Unable to read JDBC object source", error);
      }
      return source.toString();
    } catch (SQLFeatureNotSupportedException | AbstractMethodError unsupported) {
      String source = rows.getString(index);
      if (source != null && source.length() > maximumCharacters) throw new SQLException("The JDBC object source exceeds the 3 MiB safety limit");
      return source;
    }
  }

  private static List<Object> relations(DatabaseMetaData metadata, String catalog, String schema) throws SQLException {
    String[] relationTypes = isOracleDriver() ? new String[]{"TABLE", "VIEW", "MATERIALIZED VIEW"} : new String[]{"TABLE", "VIEW"};
    List<Object> result = new ArrayList<>(); try (ResultSet rows = metadata.getTables(catalog, schema, "%", relationTypes)) {
      while (rows.next()) { String relationType = rows.getString("TABLE_TYPE"); Map<String, Object> item = new LinkedHashMap<>(); item.put("name", rows.getString("TABLE_NAME")); item.put("schema", rows.getString("TABLE_SCHEM")); item.put("type", "MATERIALIZED VIEW".equalsIgnoreCase(relationType) ? "materialized_view" : "VIEW".equalsIgnoreCase(relationType) ? "view" : "table"); item.put("comment", rows.getString("REMARKS")); result.add(item); }
    } return result;
  }
  private static List<Object> columns(DatabaseMetaData metadata, String catalog, String schema, String relation) throws SQLException {
    Map<String, ColumnFacts> facts = columnFacts(metadata, catalog, schema, relation);
    List<Object> result = new ArrayList<>(); try (ResultSet rows = metadata.getColumns(catalog, schema, relation, "%")) {
      while (rows.next()) { String name = rows.getString("COLUMN_NAME"); ColumnFacts column = facts.getOrDefault(name, new ColumnFacts()); Map<String, Object> item = new LinkedHashMap<>(); item.put("name", name); item.put("data_type", rows.getString("TYPE_NAME")); item.put("is_nullable", rows.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls); item.put("is_primary_key", column.primaryKey); item.put("is_unique", column.unique); item.put("is_indexed", column.indexed); item.put("is_auto_increment", "YES".equalsIgnoreCase(optionalColumn(rows, "IS_AUTOINCREMENT"))); String generated = optionalColumn(rows, "IS_GENERATEDCOLUMN"); if (generated != null) item.put("is_generated", "YES".equalsIgnoreCase(generated)); item.put("default_value", rows.getString("COLUMN_DEF")); item.put("comment", rows.getString("REMARKS")); result.add(item); }
    } return result;
  }

  private static String optionalColumn(ResultSet rows, String name) {
    try { return rows.getString(name); } catch (SQLException | AbstractMethodError ignored) { return null; }
  }

  private static Map<String, ColumnFacts> columnFacts(DatabaseMetaData metadata, String catalog, String schema, String relation) {
    Map<String, ColumnFacts> facts = new LinkedHashMap<>();
    try (ResultSet rows = metadata.getPrimaryKeys(catalog, schema, relation)) {
      while (rows.next()) facts.computeIfAbsent(rows.getString("COLUMN_NAME"), ignored -> new ColumnFacts()).primaryKey = true;
    } catch (SQLException ignored) {}
    Map<String, List<String>> uniqueIndexes = new LinkedHashMap<>();
    try (ResultSet rows = metadata.getIndexInfo(catalog, schema, relation, false, false)) {
      while (rows.next()) {
        String column = rows.getString("COLUMN_NAME"); String name = rows.getString("INDEX_NAME");
        if (column == null || name == null || rows.getShort("TYPE") == DatabaseMetaData.tableIndexStatistic) continue;
        facts.computeIfAbsent(column, ignored -> new ColumnFacts()).indexed = true;
        if (!rows.getBoolean("NON_UNIQUE")) uniqueIndexes.computeIfAbsent(name, ignored -> new ArrayList<>()).add(column);
      }
    } catch (SQLException ignored) {}
    for (List<String> columns : uniqueIndexes.values()) if (columns.size() == 1) facts.computeIfAbsent(columns.get(0), ignored -> new ColumnFacts()).unique = true;
    return facts;
  }

  private static final class ColumnFacts { boolean primaryKey; boolean indexed; boolean unique; }
  private static List<Object> indexes(DatabaseMetaData metadata, String catalog, String schema, String relation) throws SQLException {
    Map<String, Map<String, Object>> indexes = new LinkedHashMap<>(); try (ResultSet rows = metadata.getIndexInfo(catalog, schema, relation, false, false)) {
      while (rows.next()) { String name = rows.getString("INDEX_NAME"); if (name == null) continue; Map<String, Object> item = indexes.computeIfAbsent(name, ignored -> { Map<String, Object> value = new LinkedHashMap<>(); value.put("name", name); value.put("columns", new ArrayList<Object>()); value.put("is_unique", false); value.put("is_primary", false); value.put("index_type", "JDBC"); value.put("definition", null); return value; }); item.put("is_unique", !rows.getBoolean("NON_UNIQUE")); ((List<Object>) item.get("columns")).add(rows.getString("COLUMN_NAME")); }
    } return new ArrayList<>(indexes.values());
  }
  private static List<Object> constraints(DatabaseMetaData metadata, String catalog, String schema, String relation) throws SQLException {
    Map<String, Map<String, Object>> constraints = new LinkedHashMap<>();
    // JDBC has portable primary-key and foreign-key metadata. It does not have
    // an equally portable API for check/unique definitions, so those remain a
    // dialect-specific package responsibility rather than being guessed here.
    try (ResultSet rows = metadata.getPrimaryKeys(catalog, schema, relation)) {
      while (rows.next()) {
        String name = fallback(rows.getString("PK_NAME"), "pk_" + relation);
        Map<String, Object> item = constraints.computeIfAbsent("primary:" + name, ignored -> constraint(name, "PRIMARY KEY"));
        addString(item, "columns", rows.getString("COLUMN_NAME"));
      }
    }
    try (ResultSet rows = metadata.getImportedKeys(catalog, schema, relation)) {
      while (rows.next()) {
        String name = fallback(rows.getString("FK_NAME"), "fk_" + relation + "_" + rows.getShort("KEY_SEQ"));
        String key = "foreign:" + name + ":" + fallback(rows.getString("PKTABLE_NAME"), "");
        Map<String, Object> item = constraints.computeIfAbsent(key, ignored -> constraint(name, "FOREIGN KEY"));
        addString(item, "columns", rows.getString("FKCOLUMN_NAME"));
        item.put("referenced_schema", nullableSchema(rows.getString("PKTABLE_SCHEM"), rows.getString("PKTABLE_CAT")));
        item.put("referenced_table", rows.getString("PKTABLE_NAME"));
        addString(item, "referenced_columns", rows.getString("PKCOLUMN_NAME"));
      }
    }
    return new ArrayList<>(constraints.values());
  }
  private static List<Object> referencingForeignKeys(DatabaseMetaData metadata, String catalog, String schema, String relation) throws SQLException {
    Map<String, Map<String, Object>> references = new LinkedHashMap<>();
    try (ResultSet rows = metadata.getExportedKeys(catalog, schema, relation)) {
      while (rows.next()) {
        String owner = rows.getString("FKTABLE_NAME"); if (owner == null || owner.isBlank()) continue;
        String name = fallback(rows.getString("FK_NAME"), "fk_" + owner + "_" + rows.getShort("KEY_SEQ"));
        String ownerSchema = fallback(nullableSchema(rows.getString("FKTABLE_SCHEM"), rows.getString("FKTABLE_CAT")), "");
        String referencedSchema = fallback(nullableSchema(rows.getString("PKTABLE_SCHEM"), rows.getString("PKTABLE_CAT")), fallback(schema, ""));
        String referencedTable = fallback(rows.getString("PKTABLE_NAME"), relation);
        Map<String, Object> item = references.computeIfAbsent(ownerSchema + ":" + owner + ":" + name, ignored -> {
          Map<String, Object> value = new LinkedHashMap<>(); value.put("name", name); value.put("schema", ownerSchema); value.put("table", owner);
          value.put("columns", new ArrayList<Object>()); value.put("referenced_schema", referencedSchema);
          value.put("referenced_table", referencedTable); value.put("referenced_columns", new ArrayList<Object>()); return value;
        });
        addString(item, "columns", rows.getString("FKCOLUMN_NAME")); addString(item, "referenced_columns", rows.getString("PKCOLUMN_NAME"));
      }
    }
    return new ArrayList<>(references.values());
  }
  private static List<Object> routines(DatabaseMetaData metadata, String catalog, String schema) {
    Map<String, Object> routines = new LinkedHashMap<>(); Set<String> procedures = new LinkedHashSet<>();
    // JDBC drivers are allowed not to implement routine metadata. Treat this
    // feature as optional instead of failing the entire schema tree.
    try (ResultSet rows = metadata.getProcedures(catalog, schema, "%")) {
      while (rows.next()) {
        String name = rows.getString("PROCEDURE_NAME"); if (name == null || name.isBlank()) continue;
        procedures.add(name); routines.putIfAbsent("procedure:" + name, routine(name, "PROCEDURE", rows.getString("REMARKS")));
      }
    } catch (SQLException | AbstractMethodError ignored) {}
    try (ResultSet rows = metadata.getFunctions(catalog, schema, "%")) {
      while (rows.next()) {
        String name = rows.getString("FUNCTION_NAME"); if (name == null || name.isBlank() || procedures.contains(name)) continue;
        routines.putIfAbsent("function:" + name, routine(name, "FUNCTION", rows.getString("REMARKS")));
      }
    } catch (SQLException | AbstractMethodError ignored) {}
    return new ArrayList<>(routines.values());
  }
  private static Map<String, Object> routine(String name, String type, String description) {
    Map<String, Object> value = new LinkedHashMap<>(); value.put("name", name); value.put("routine_type", type);
    value.put("parameters", new ArrayList<Object>()); value.put("return_type", ""); value.put("description", description); return value;
  }
  private static Map<String, Object> constraint(String name, String type) {
    Map<String, Object> value = new LinkedHashMap<>(); value.put("name", name); value.put("constraint_type", type); value.put("columns", new ArrayList<Object>());
    value.put("referenced_schema", null); value.put("referenced_table", null); value.put("referenced_columns", new ArrayList<Object>()); value.put("definition", null); return value;
  }
  @SuppressWarnings("unchecked") private static void addString(Map<String, Object> item, String field, String value) { if (value != null && !value.isBlank()) ((List<Object>) item.get(field)).add(value); }
  private static String nullableSchema(String schema, String catalog) { return schema != null && !schema.isBlank() ? schema : catalog != null && !catalog.isBlank() ? catalog : null; }
  private static String fallback(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }
  private static Map<String, Object> rows(ResultSet result, String sql) throws SQLException {
    ResultSetMetaData metadata = result.getMetaData(); List<Object> columns = new ArrayList<>(); List<Object> rows = new ArrayList<>();
    for (int index = 1; index <= metadata.getColumnCount(); index++) { Map<String, Object> column = new LinkedHashMap<>(); column.put("name", metadata.getColumnLabel(index)); column.put("dataType", metadata.getColumnTypeName(index)); columns.add(column); }
    int usedCharacters = 0; boolean truncated = false;
    while (result.next()) {
      if (rows.size() >= MAX_RESULT_ROWS) { truncated = true; break; }
      List<Object> row = new ArrayList<>(); int rowCharacters = 0;
      for (int index = 1; index <= metadata.getColumnCount(); index++) {
        Object value = normalizeResultValue(result, index, metadata.getColumnTypeName(index));
        row.add(value); rowCharacters += estimatedCharacters(value);
      }
      if (usedCharacters + rowCharacters > MAX_RESULT_CHARACTERS) { truncated = true; break; }
      usedCharacters += rowCharacters; rows.add(row);
    }
    Map<String, Object> output = emptyQuery(sql); output.put("columns", columns); output.put("rows", rows);
    output.put("truncated", truncated); output.put("rowLimit", MAX_RESULT_ROWS); return output;
  }
  /**
   * Oracle's Esri SDE.ST_GEOMETRY is a vendor object which some JDBC driver
   * versions cannot materialize through getObject(). A generic JDBC package
   * cannot safely rewrite arbitrary SELECT lists to SDE.ST_AsText, but it can
   * keep the rest of the result set available and make this limitation
   * explicit. Dedicated Oracle packages may replace this with a proven WKT
   * adapter later.
   */
  private static Object normalizeResultValue(ResultSet result, int index, String typeName) throws SQLException {
    if (!isOracleSdeGeometry(typeName)) return normalize(result.getObject(index));
    try {
      String value = result.getString(index);
      return value == null ? null : boundedVendorValue(value);
    } catch (SQLException ignored) {
      return "<SDE.ST_GEOMETRY unavailable in generic JDBC Agent>";
    }
  }
  private static boolean isOracleSdeGeometry(String typeName) {
    if (!isOracleDriver() || typeName == null) return false;
    String normalized = typeName.trim().toUpperCase(java.util.Locale.ROOT);
    return "SDE.ST_GEOMETRY".equals(normalized) || "ST_GEOMETRY".equals(normalized);
  }
  private static String boundedVendorValue(String value) {
    if (value.length() <= MAX_CELL_CHARACTERS) return value;
    return value.substring(0, MAX_CELL_CHARACTERS) + "… [value truncated]";
  }
  private static int estimatedCharacters(Object value) { return value == null ? 4 : String.valueOf(value).length() + 8; }
  private static Map<String, Object> emptyQuery(String sql) { Map<String, Object> result = new LinkedHashMap<>(); result.put("columns", List.of()); result.put("rows", List.of()); result.put("truncated", false); result.put("rowLimit", MAX_RESULT_ROWS); result.put("rowsAffected", null); result.put("statementType", sql.trim().split("\\s+", 2)[0].toUpperCase()); result.put("message", null); return result; }
  private static List<Object> strings(ResultSet rows, String field) throws SQLException { List<Object> result = new ArrayList<>(); try (rows) { while (rows.next()) { String value = rows.getString(field); if (value != null && !value.isBlank()) result.add(value); } } return result; }
  private static Object normalize(Object value) {
    if (value == null) return null;
    // Keep JSON-native scalar values native. Returning every JDBC value as a
    // string makes numeric columns sort lexicographically in the Data Grid
    // (for example, 10 before 2), and prevents normal typed-cell editing.
    // JDBC temporal, vendor and binary values remain display-safe strings.
    if (value instanceof Boolean || value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long || value instanceof BigDecimal) return value;
    if (value instanceof Float number) return Float.isFinite(number) ? number : String.valueOf(number);
    if (value instanceof Double number) return Double.isFinite(number) ? number : String.valueOf(number);
    if (value instanceof byte[] bytes) {
      // Encode only a bounded prefix. Encoding a multi-megabyte BLOB first
      // would defeat the response budget before we get a chance to truncate.
      int maxBytes = Math.min(bytes.length, (MAX_CELL_CHARACTERS * 3) / 4);
      String encoded = Base64.getEncoder().encodeToString(java.util.Arrays.copyOf(bytes, maxBytes));
      return maxBytes == bytes.length ? encoded : encoded + "… [binary value truncated]";
    }
    return boundedVendorValue(String.valueOf(value));
  }
  private static Map<String, Object> value(String kind, Object value) { Map<String, Object> result = new LinkedHashMap<>(); result.put("kind", kind); result.put("value", value); return result; }
  private static Map<String, Object> ok(long id, Map<String, Object> result) { Map<String, Object> response = new LinkedHashMap<>(); response.put("id", id); response.put("status", "ok"); response.put("result", result); return response; }
  private static String errorCode(String method, Exception error) {
    if (!(error instanceof SQLException)) return "JDBC_DRIVER_ERROR";
    return switch (method) {
      case "connect" -> "CONNECT_FAILED";
      case "ping" -> "PING_FAILED";
      case "serverVersion" -> "VERSION_FAILED";
      case "query" -> "QUERY_FAILED";
      case "metadata" -> "METADATA_FAILED";
      case "createDatabase" -> "DATABASE_CREATION_FAILED";
      case "cancel" -> "CANCELLATION_FAILED";
      default -> "JDBC_DRIVER_ERROR";
    };
  }
  private static Map<String, Object> error(long id, String code, String message) { Map<String, Object> details = new LinkedHashMap<>(); Map<String, Object> item = new LinkedHashMap<>(); item.put("code", code); item.put("message", message); item.put("retryable", false); item.put("details", details); Map<String, Object> response = new LinkedHashMap<>(); response.put("id", id); response.put("status", "error"); response.put("result", item); return response; }
  private static String requiredEnv(String name) { String value = System.getenv(name); if (value == null || value.isBlank()) throw new IllegalStateException("Host did not bind driver identity"); return value; }
  private static void close(Connection connection) { if (connection != null) try { connection.close(); } catch (SQLException ignored) {} }
  private static String safeMessage(Exception error) {
    String value = error.getMessage();
    if (value == null || value.isBlank()) return error.getClass().getSimpleName();
    // JDBC vendors commonly repeat the supplied URL in exceptions. Never let
    // URL userinfo or password/token query properties cross the sidecar IPC
    // boundary, even in a classified error response.
    value = value.replaceAll("(?i)([a-z][a-z0-9+.-]*://[^\\s/@:]+):[^\\s@/]+@", "$1:<redacted>@");
    value = value.replaceAll("(?i)((?:password|pwd|token|secret)\\s*[=:]\\s*)[^\\s;,&]+", "$1<redacted>");
    return value.substring(0, Math.min(value.length(), 1024));
  }
  @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) { return value instanceof Map<?, ?> map ? (Map<String, Object>) map : new LinkedHashMap<>(); }
  @SuppressWarnings("unchecked") private static List<Object> array(Object value) { return value instanceof List<?> list ? (List<Object>) list : List.of(); }
  private static String text(Object value) { if (value == null) throw new IllegalArgumentException("Required string field is missing"); return String.valueOf(value); }
  private static String nullable(Object value) { return value == null ? null : String.valueOf(value); }
  private static Number number(Object value) { if (value instanceof Number number) return number; return Long.parseLong(String.valueOf(value)); }

  private static final class Json {
    static Object parse(String value) { return new Parser(value).parse(); }
    static String stringify(Object value) { StringBuilder output = new StringBuilder(); write(output, value); return output.toString(); }
    @SuppressWarnings("unchecked") static void write(StringBuilder output, Object value) { if (value == null) { output.append("null"); } else if (value instanceof String text) { output.append('"'); for (int index = 0; index < text.length(); index++) { char character = text.charAt(index); switch (character) { case '"' -> output.append("\\\""); case '\\' -> output.append("\\\\"); case '\n' -> output.append("\\n"); case '\r' -> output.append("\\r"); case '\t' -> output.append("\\t"); default -> { if (character < 0x20) output.append(String.format("\\u%04x", (int) character)); else output.append(character); } } } output.append('"'); } else if (value instanceof Number || value instanceof Boolean) { output.append(value); } else if (value instanceof Map<?, ?> map) { output.append('{'); boolean first = true; for (Map.Entry<?, ?> entry : map.entrySet()) { if (!first) output.append(','); first = false; write(output, String.valueOf(entry.getKey())); output.append(':'); write(output, entry.getValue()); } output.append('}'); } else if (value instanceof Iterable<?> values) { output.append('['); boolean first = true; for (Object item : values) { if (!first) output.append(','); first = false; write(output, item); } output.append(']'); } else { write(output, String.valueOf(value)); } }
    private static final class Parser { private final String input; private int at; Parser(String input) { this.input = input; } Object parse() { Object value = value(); whitespace(); if (at != input.length()) throw bad(); return value; } Object value() { whitespace(); if (at >= input.length()) throw bad(); return switch (input.charAt(at)) { case '{' -> object(); case '[' -> array(); case '"' -> string(); case 't' -> literal("true", true); case 'f' -> literal("false", false); case 'n' -> literal("null", null); default -> number(); }; } Map<String, Object> object() { at++; Map<String, Object> result = new LinkedHashMap<>(); whitespace(); if (consume('}')) return result; do { whitespace(); String key = string(); whitespace(); expect(':'); result.put(key, value()); whitespace(); } while (consume(',')); expect('}'); return result; } List<Object> array() { at++; List<Object> result = new ArrayList<>(); whitespace(); if (consume(']')) return result; do { result.add(value()); whitespace(); } while (consume(',')); expect(']'); return result; } String string() { expect('"'); StringBuilder result = new StringBuilder(); while (at < input.length()) { char c = input.charAt(at++); if (c == '"') return result.toString(); if (c != '\\') { result.append(c); continue; } if (at >= input.length()) throw bad(); switch (input.charAt(at++)) { case '"' -> result.append('"'); case '\\' -> result.append('\\'); case '/' -> result.append('/'); case 'b' -> result.append('\b'); case 'f' -> result.append('\f'); case 'n' -> result.append('\n'); case 'r' -> result.append('\r'); case 't' -> result.append('\t'); case 'u' -> { if (at + 4 > input.length()) throw bad(); result.append((char) Integer.parseInt(input.substring(at, at += 4), 16)); } default -> throw bad(); } } throw bad(); } Object literal(String expected, Object value) { if (!input.startsWith(expected, at)) throw bad(); at += expected.length(); return value; } Number number() { int start = at; while (at < input.length() && "-+0123456789.eE".indexOf(input.charAt(at)) >= 0) at++; String raw = input.substring(start, at); try { return raw.contains(".") || raw.contains("e") || raw.contains("E") ? new BigDecimal(raw) : Long.parseLong(raw); } catch (NumberFormatException error) { throw bad(); } } void whitespace() { while (at < input.length() && Character.isWhitespace(input.charAt(at))) at++; } boolean consume(char expected) { if (at < input.length() && input.charAt(at) == expected) { at++; return true; } return false; } void expect(char expected) { if (!consume(expected)) throw bad(); } IllegalArgumentException bad() { return new IllegalArgumentException("Invalid JSON request"); } }
  }
}

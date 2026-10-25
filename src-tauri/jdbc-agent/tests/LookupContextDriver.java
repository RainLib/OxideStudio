import java.lang.reflect.*;
import java.sql.*;
import java.util.Properties;
import java.util.logging.Logger;

/** JDBC boundary fixture. SQL semantics are supplied deterministically; this
 * is not a SQL Server engine or an implementation of the Host algorithm. */
public final class LookupContextDriver implements Driver {
  static { try { DriverManager.registerDriver(new LookupContextDriver()); } catch (SQLException e) { throw new ExceptionInInitializerError(e); } }
  public boolean acceptsURL(String url) { return url.startsWith("jdbc:lookup:"); }
  public Connection connect(String url, Properties properties) {
    if (!acceptsURL(url)) return null;
    class State { String catalog="original"; boolean closed=false; }
    State state=new State();
    return proxy(Connection.class,(object,method,args)->switch(method.getName()) {
      case "getCatalog" -> state.catalog;
      case "setCatalog" -> { if (!"ignored".equals(args[0])) state.catalog=(String)args[0]; yield null; }
      case "getSchema" -> "selected_schema_is_not_the_default";
      case "setSchema" -> throw new SQLException("lookup must not set the selected schema");
      case "close" -> { state.closed=true;yield null; }
      case "isClosed" -> state.closed;
      case "isValid" -> !state.closed;
      case "getMetaData" -> proxy(DatabaseMetaData.class,(o,m,a)->null);
      case "prepareStatement" -> {
        if (!"SELECT DB_NAME(), SCHEMA_NAME()".equals(args[0])) throw new SQLException("unexpected or interpolated SQL");
        if ("sql_error".equals(state.catalog)) throw new SQLException("fixture statement error");
        String database=state.catalog;
        yield proxy(PreparedStatement.class,(o,m,a)->switch(m.getName()) {
          case "executeQuery" -> {
            int[] row={0};
            yield proxy(ResultSet.class,(r,rm,ra)->switch(rm.getName()) {
              case "next" -> ++row[0] <= ("multi".equals(database)?2:1);
              case "getString" -> ((Integer)ra[0])==1 ? ("mismatch".equals(database)?"wrong":database) : ("missing".equals(database)?null:"default_"+database);
              default -> defaultValue(rm.getReturnType());
            });
          }
          default -> defaultValue(m.getReturnType());
        });
      }
      default -> defaultValue(method.getReturnType());
    });
  }
  private static <T> T proxy(Class<T> type, InvocationHandler handler) {
    return type.cast(Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},handler));
  }
  private static Object defaultValue(Class<?> type) {
    if (type==boolean.class)return false;if(type==int.class)return 0;if(type==long.class)return 0L;return null;
  }
  public DriverPropertyInfo[] getPropertyInfo(String u,Properties p){return new DriverPropertyInfo[0];}
  public int getMajorVersion(){return 1;}public int getMinorVersion(){return 0;}
  public boolean jdbcCompliant(){return false;}public Logger getParentLogger(){return Logger.getGlobal();}
}

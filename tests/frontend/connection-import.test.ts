import { describe, expect, it } from "vitest";
import {
  detectConnectionImportSource,
  parseConnectionImport,
  sanitizeImportedConnectionUrl,
} from "@/features/connection-import";

describe("external connection import", () => {
  it("parses DataGrip endpoint fields without importing a password", () => {
    const result = parseConnectionImport(
      "datagrip",
      `<application><component>
        <data-source name="Analytics" uuid="data-source-1" driver-ref="postgresql">
          <option name="url" value="jdbc:postgresql://alice:secret@db.example.test:5432/analytics?sslmode=require" />
          <option name="user" value="reporter" />
        </data-source>
      </component></application>`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        id: "datagrip:data-source-1",
        name: "Analytics",
        driver: "postgres",
        host: "db.example.test",
        port: 5432,
        database: "analytics",
        user: "reporter",
      }),
    ]);
    expect(result.candidates[0]?.connectionUrl).not.toContain("secret");
  });

  it("parses DBeaver JSON while leaving encrypted and inline password values behind", () => {
    const result = parseConnectionImport(
      "dbeaver",
      JSON.stringify({
        connections: {
          source: {
            id: "dbeaver-1",
            name: "Warehouse",
            provider: "clickhouse",
            configuration: {
              url: "jdbc:clickhouse://reader:password@warehouse.example.test:8123/default?token=secret-token",
              user: "analyst",
              password: "not-imported",
            },
          },
        },
      }),
    );

    expect(result.candidates[0]).toMatchObject({
      id: "dbeaver:dbeaver-1",
      driver: "clickhouse",
      host: "warehouse.example.test",
      port: 8123,
      database: "default",
      user: "analyst",
    });
    expect(result.candidates[0]?.connectionUrl).not.toMatch(/password|secret-token/iu);
    expect(result.candidates[0]).not.toHaveProperty("password");
    expect(result.candidates[0]?.warnings).toContain(
      "Sensitive URL parameters were removed.",
    );
  });

  it("leaves unknown products as diagnostics instead of guessing a driver", () => {
    const result = parseConnectionImport(
      "dbeaver",
      JSON.stringify({
        connections: [{ id: "unknown", name: "Mystery", provider: "unknown-db" }],
      }),
    );
    expect(result.candidates[0]).toMatchObject({ driver: null });
    expect(result.candidates[0]?.warnings).toContain(
      "No supported OxideStudio driver could be identified.",
    );
  });

  it("redacts credentials and secret URL parameters before anything reaches preview", () => {
    const sanitized = sanitizeImportedConnectionUrl(
      "jdbc:sqlserver://sa:password@host:1433;password=again?token=secret",
    );
    expect(sanitized).not.toContain("sa:password");
    expect(sanitized).not.toContain("again");
    expect(sanitized).not.toContain("secret");
  });

  it("redacts Oracle Thin inline credentials while retaining endpoint metadata", () => {
    const result = parseConnectionImport(
      "datagrip",
      `<component><data-source uuid="oracle-1" name="Ledger">
        <driver-ref>oracle</driver-ref>
        <jdbc-url>jdbc:oracle:thin:scott/tiger@//oracle.example.test:1521/ledger</jdbc-url>
      </data-source></component>`,
    );

    expect(result.candidates[0]).toMatchObject({
      driver: "oracle",
      host: "oracle.example.test",
      port: 1521,
      database: "ledger",
    });
    expect(result.candidates[0]?.connectionUrl).not.toContain("scott");
    expect(result.candidates[0]?.connectionUrl).not.toContain("tiger");
    expect(result.candidates[0]?.warnings).toContain(
      "Sensitive URL parameters were removed.",
    );
  });

  it("reads the DBX DataGrip export envelope instead of treating it as DBeaver JSON", () => {
    const exportPayload = JSON.stringify({
      format: "datagrip-import",
      dataSources: `<component>
        <data-source uuid="pg-1" name="Orders">
          <driver-ref>postgresql</driver-ref>
          <jdbc-url>jdbc:postgresql://orders.example.test:5432/orders</jdbc-url>
          <user-name>reporter</user-name>
        </data-source>
      </component>`,
      // Deliberately ignored: a local file must never become a credential source.
      dataSourcesLocal: `<component><data-source uuid="pg-1"><password>secret</password></data-source></component>`,
    });

    expect(detectConnectionImportSource("dbx-export.json", exportPayload)).toBe(
      "datagrip",
    );
    expect(parseConnectionImport("datagrip", exportPayload).candidates).toEqual([
      expect.objectContaining({
        id: "datagrip:pg-1",
        name: "Orders",
        driver: "postgres",
        host: "orders.example.test",
        port: 5432,
        database: "orders",
        user: "reporter",
      }),
    ]);
  });

  it("reads the DBX DBeaver export envelope without decrypting credentials", () => {
    const exportPayload = JSON.stringify({
      format: "dbeaver-import",
      dataSources: JSON.stringify({
        connections: [{
          id: "warehouse-1",
          name: "Warehouse",
          provider: "trino",
          configuration: {
            url: "jdbc:trino://warehouse.example.test:8443/analytics/default",
            user: "analyst",
            password: "never-read",
          },
        }],
      }),
      credentialsBase64: "not-read",
    });

    expect(detectConnectionImportSource("dbx-export.json", exportPayload)).toBe(
      "dbeaver",
    );
    const result = parseConnectionImport("dbeaver", exportPayload);
    expect(result.candidates[0]).toMatchObject({
      id: "dbeaver:warehouse-1",
      driver: "trino",
      host: "warehouse.example.test",
      port: 8443,
      database: "analytics",
      user: "analyst",
    });
    expect(result.candidates[0]).not.toHaveProperty("password");
  });

  it("parses Navicat NCX endpoint fields without reading password data", () => {
    const content = `<Connections>
      <Connection Id="nav-1" ConnName="Reporting" ConnType="PostgreSQL"
        Host="pg.example.test" Port="5432" Database="analytics" UserName="reader"
        Password="opaque-navicat-value" Folder="Warehouse" />
    </Connections>`;
    expect(detectConnectionImportSource("connections.ncx", content)).toBe("navicat");
    const result = parseConnectionImport("navicat", content);

    expect(result.candidates[0]).toMatchObject({
      id: "navicat:nav-1",
      source: "navicat",
      name: "Reporting",
      driver: "postgres",
      host: "pg.example.test",
      port: 5432,
      database: "analytics",
      user: "reader",
    });
    expect(result.candidates[0]).not.toHaveProperty("password");
    expect(result.candidates[0]?.warnings).toContain(
      "Navicat password data was not imported.",
    );
    expect(result.candidates[0]?.warnings).toContain(
      "Navicat folder/group placement was not imported.",
    );
  });
});

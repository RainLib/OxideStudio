import { describe, expect, it } from "vitest";
import {
  schemaDiagramRasterSize,
  serializeSchemaDiagramToSvg,
} from "./schemaDiagramSvg";

describe("schema diagram SVG export", () => {
  it("serializes nodes and relationship paths without unsafe XML", () => {
    const svg = serializeSchemaDiagramToSvg({
      snapshotId: "snapshot-1",
      width: 800,
      height: 500,
      totalRelationCount: 2,
      totalRelationshipCount: 1,
      externalRelationshipCount: 0,
      nodes: [
        {
          id: "orders",
          relationName: "orders & invoices",
          objectType: "TABLE",
          x: 40,
          y: 40,
          width: 240,
          height: 80,
          columns: [
            {
              name: "customer_id",
              dataType: "uuid",
              nullable: false,
              primaryKey: false,
              foreignKey: true,
              unique: false,
              indexed: true,
            },
          ],
          hiddenColumnCount: 0,
          totalColumnCount: 1,
        },
        {
          id: "customers",
          relationName: "customers",
          objectType: "TABLE",
          x: 400,
          y: 40,
          width: 240,
          height: 80,
          columns: [],
          hiddenColumnCount: 0,
          totalColumnCount: 0,
        },
      ],
      edges: [
        {
          id: "fk",
          constraintName: "orders_customer_fk",
          sourceRelation: "orders & invoices",
          sourceColumns: ["customer_id"],
          targetSchema: "public",
          targetRelation: "customers",
          targetColumns: ["id"],
        },
      ],
    }, {
      annotations: [{
        content: "Owner <Platform> & Security",
        x: 720,
        y: 400,
        width: 220,
        height: 120,
        color: "amber",
      }],
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("orders &amp; invoices");
    expect(svg).toContain("orders_customer_fk");
    expect(svg).toContain("<path");
    expect(svg).toContain("Owner &lt;Platform&gt; &amp; Security");
    expect(svg).toContain('width="988"');
    expect(svg).not.toContain("orders & invoices");
  });
});

describe("schemaDiagramRasterSize", () => {
  it("caps very large canvas pixel counts without changing aspect ratio", () => {
    const size = schemaDiagramRasterSize(10_000, 10_000, 25_000_000);
    expect(size).toEqual({ width: 5_000, height: 5_000, scale: 0.5 });
  });
});

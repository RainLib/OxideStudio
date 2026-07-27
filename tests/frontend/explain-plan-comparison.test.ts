import { describe, expect, it, vi } from "vitest";
import {
  analyzePatchExplainPlan,
  completePatchSqlDocuments,
  comparePatchExplainPlans,
  reviewRuntimeExplainPlan,
} from "@/lib/explainPlanComparison";
import type { ExplainPlan } from "@/services/tauri/types";

function plan(
  id: string,
  totalCost: number,
  estimatedRows: number,
  childCount = 0,
): ExplainPlan {
  return {
    id,
    driver: "postgres",
    mode: "estimate",
    format: "json",
    generatedInMs: 4,
    totalCost,
    estimatedRows,
    rawPlan: {},
    warnings: ["Estimated plan; the query was not executed."],
    root: {
      id: `${id}:root`,
      nodeType: "Seq Scan",
      totalCost,
      estimatedRows,
      children: Array.from({ length: childCount }, (_, index) => ({
        id: `${id}:child:${index}`,
        nodeType: "Index Scan",
        children: [],
      })),
    },
  };
}

describe("patch Explain Plan comparison", () => {
  it("applies a partial replacement before explaining complete SQL documents", () => {
    expect(
      completePatchSqlDocuments("SELECT * FROM users", {
        id: "patch-columns",
        title: "Select explicit columns",
        range: {
          startLine: 1,
          startColumn: 8,
          endLine: 1,
          endColumn: 9,
        },
        originalText: "*",
        replacement: "id, email",
        expectedRevision: "revision-1",
      }),
    ).toEqual({
      beforeSql: "SELECT * FROM users",
      afterSql: "SELECT id, email FROM users",
    });
  });

  it("runs two explicit estimate-only plans and computes bounded metrics", async () => {
    const explainQuery = vi
      .fn()
      .mockResolvedValueOnce(plan("before", 120, 400, 2))
      .mockResolvedValueOnce(plan("after", 72, 40, 1));

    const comparison = await comparePatchExplainPlans({
      connectionId: "postgres-1",
      beforeSql: " SELECT * FROM users ",
      afterSql: "SELECT id FROM users WHERE active = TRUE",
      schema: "public",
      explainQuery,
    });

    expect(explainQuery).toHaveBeenCalledTimes(2);
    expect(explainQuery.mock.calls[0]?.[0]).toMatchObject({
      connectionId: "postgres-1",
      sql: "SELECT * FROM users",
      schema: "public",
      database: undefined,
      mode: "estimate",
    });
    expect(explainQuery.mock.calls[1]?.[0]).toMatchObject({
      sql: "SELECT id FROM users WHERE active = TRUE",
      mode: "estimate",
    });
    expect(explainQuery.mock.calls[0]?.[0].queryId).not.toBe(
      explainQuery.mock.calls[1]?.[0].queryId,
    );
    expect(comparison.totalCost).toEqual({
      before: 120,
      after: 72,
      delta: -48,
      percentChange: -40,
    });
    expect(comparison.estimatedRows.delta).toBe(-360);
    expect(comparison.nodeCount).toMatchObject({
      before: 3,
      after: 2,
      delta: -1,
    });
  });

  it("uses database scope instead of schema and labels the failing side", async () => {
    const explainQuery = vi
      .fn()
      .mockResolvedValueOnce(plan("before", 10, 1))
      .mockRejectedValueOnce(new Error("read-only query required"));

    await expect(
      comparePatchExplainPlans({
        connectionId: "postgres-1",
        beforeSql: "SELECT 1",
        afterSql: "UPDATE users SET active = TRUE",
        schema: "public",
        database: "analytics",
        explainQuery,
      }),
    ).rejects.toThrow(
      "After SQL could not be explained. Select a complete read-only query.",
    );
    expect(explainQuery.mock.calls[0]?.[0]).toMatchObject({
      schema: undefined,
      database: "analytics",
      mode: "estimate",
    });
  });

  it("summarizes relation access and newly used indexes without claiming performance", async () => {
    const before = plan("before", 200, 500);
    before.root.relation = "users";
    before.root.nodeType = "Seq Scan";
    const after = plan("after", 80, 20);
    after.root.relation = "users";
    after.root.nodeType = "Index Scan";
    after.root.index = "users_active_idx";
    const explainQuery = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const comparison = await comparePatchExplainPlans({
      connectionId: "postgres-1",
      beforeSql: "SELECT * FROM users",
      afterSql: "SELECT * FROM users WHERE active = TRUE",
      explainQuery,
    });

    expect(comparison.facts).toEqual([
      {
        label: "users",
        before: "Seq Scan",
        after: "Index Scan · users_active_idx",
      },
      { label: "Full scans", before: "1", after: "0" },
      {
        label: "New index usage",
        before: "None",
        after: "users_active_idx",
      },
    ]);
  });

  it("flags bounded optimizer-estimate hotspots without claiming runtime impact", async () => {
    const before = plan("before", 200, 500);
    before.root.relation = "users";
    before.root.nodeType = "Index Scan";
    before.root.index = "users_active_idx";
    const after = plan("after", 1_800, 25_000);
    after.root.relation = "users";
    after.root.nodeType = "Seq Scan";
    const explainQuery = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const comparison = await comparePatchExplainPlans({
      connectionId: "postgres-1",
      beforeSql: "SELECT * FROM users WHERE active = TRUE",
      afterSql: "SELECT * FROM users",
      explainQuery,
    });

    expect(comparison.hotspots).toEqual([
      {
        id: "estimated-cost-growth",
        severity: "warning",
        title: "Estimated cost increased",
        evidence: "200 → 1,800 · +800.0%",
      },
      {
        id: "estimated-row-growth",
        severity: "warning",
        title: "Estimated output grew",
        evidence: "500 → 25,000 rows · +4,900.0%",
      },
      {
        id: "large-full-scan:after:root",
        severity: "warning",
        title: "Full scan introduced on users",
        evidence: "Seq Scan · users · 25,000 estimated rows · 1,800 cost",
      },
    ]);
  });

  it("does not contact the database after cancellation or for unchanged SQL", async () => {
    const explainQuery = vi.fn<() => Promise<ExplainPlan>>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      comparePatchExplainPlans({
        connectionId: "postgres-1",
        beforeSql: "SELECT 1",
        afterSql: "SELECT 2",
        signal: controller.signal,
        explainQuery,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      comparePatchExplainPlans({
        connectionId: "postgres-1",
        beforeSql: "SELECT 1",
        afterSql: " SELECT 1 ",
        explainQuery,
      }),
    ).rejects.toThrow("does not change");
    expect(explainQuery).not.toHaveBeenCalled();
  });

  it("cancels the active estimate request when review closes", async () => {
    let rejectPlan: (reason: Error) => void = () => undefined;
    const explainQuery = vi.fn(
      () =>
        new Promise<ExplainPlan>((_resolve, reject) => {
          rejectPlan = reject;
        }),
    );
    const cancelQuery = vi.fn(async () => {
      rejectPlan(new Error("backend cancellation acknowledged"));
    });
    const controller = new AbortController();

    const comparison = comparePatchExplainPlans({
      connectionId: "postgres-1",
      beforeSql: "SELECT * FROM users",
      afterSql: "SELECT id FROM users",
      signal: controller.signal,
      explainQuery,
      cancelQuery,
    });
    await Promise.resolve();
    controller.abort();

    await expect(comparison).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelQuery).toHaveBeenCalledOnce();
    expect(cancelQuery.mock.calls[0]?.[0]).toMatch(
      /^patch-plan:.*:before$/,
    );
  });

  it("runs an explicit analyzed plan for the complete proposed query", async () => {
    const analyzedPlan: ExplainPlan = {
      ...plan("actual", 30, 10),
      mode: "analyze",
      planningTimeMs: 0.8,
      executionTimeMs: 12.6,
      root: {
        ...plan("actual", 30, 10).root,
        actualTotalTimeMs: 12.1,
        actualRows: 25,
        loops: 1,
      },
    };
    const explainQuery = vi.fn(async () => analyzedPlan);

    const result = await analyzePatchExplainPlan({
      connectionId: "postgres-1",
      sql: " SELECT id FROM users WHERE active = TRUE ",
      schema: "public",
      database: "analytics",
      explainQuery,
    });

    expect(result).toBe(analyzedPlan);
    expect(explainQuery).toHaveBeenCalledWith({
      connectionId: "postgres-1",
      sql: "SELECT id FROM users WHERE active = TRUE",
      schema: undefined,
      database: "analytics",
      queryId: expect.stringMatching(/^patch-plan:.*:actual$/),
      mode: "analyze",
    });
  });

  it("cancels the active runtime request when review closes", async () => {
    let rejectPlan: (reason: Error) => void = () => undefined;
    const explainQuery = vi.fn(
      () =>
        new Promise<ExplainPlan>((_resolve, reject) => {
          rejectPlan = reject;
        }),
    );
    const cancelQuery = vi.fn(async () => {
      rejectPlan(new Error("backend cancellation acknowledged"));
    });
    const controller = new AbortController();

    const analyzed = analyzePatchExplainPlan({
      connectionId: "postgres-1",
      sql: "SELECT id FROM users",
      signal: controller.signal,
      explainQuery,
      cancelQuery,
    });
    await Promise.resolve();
    controller.abort();

    await expect(analyzed).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelQuery).toHaveBeenCalledOnce();
    expect(cancelQuery.mock.calls[0]?.[0]).toMatch(
      /^patch-plan:.*:actual$/,
    );
  });

  it("summarizes actual timing and material row-estimate mismatch", () => {
    const analyzedPlan: ExplainPlan = {
      ...plan("actual-review", 70, 10),
      mode: "analyze",
      planningTimeMs: 1.2,
      executionTimeMs: 18.4,
      root: {
        ...plan("actual-review", 70, 10).root,
        actualTotalTimeMs: 17.8,
        actualRows: 250,
        loops: 1,
        children: [
          {
            id: "actual-review:child",
            nodeType: "Index Scan",
            relation: "users",
            estimatedRows: 5,
            actualTotalTimeMs: 15.2,
            actualRows: 5,
            loops: 50,
            children: [],
          },
        ],
      },
    };

    const review = reviewRuntimeExplainPlan(analyzedPlan);

    expect(review).toMatchObject({
      driver: "postgres",
      executionTimeMs: 18.4,
      planningTimeMs: 1.2,
      actualRows: 250,
      loops: 1,
      slowestNodes: [
        expect.objectContaining({
          id: "actual-review:root",
          actualTotalTimeMs: 17.8,
        }),
        expect.objectContaining({
          id: "actual-review:child",
          relation: "users",
          actualTotalTimeMs: 15.2,
        }),
      ],
      signals: [
        {
          id: "row-misestimate:actual-review:root",
          severity: "warning",
          title: "Row estimate differs at Seq Scan",
          evidence: "10 estimated · 250 actual · 25×",
        },
      ],
    });
  });
});

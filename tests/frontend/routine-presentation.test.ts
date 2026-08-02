import { describe, expect, it } from "vitest";
import {
  routineCallTemplate,
  routineKind,
  routineKindLabel,
  routineSignature,
} from "@/features/database-explorer/model/routinePresentation";

describe("routine presentation", () => {
  it("uses function semantics by default and preserves parameter metadata", () => {
    const routine = {
      name: "find_orders",
      parameters: [
        { name: "account_id", data_type: "uuid" },
        { name: "limit", data_type: "integer", optional: true },
      ],
      return_type: "setof orders",
    };

    expect(routineKind(routine)).toBe("function");
    expect(routineKindLabel(routine)).toBe("fn");
    expect(routineSignature(routine)).toBe(
      "find_orders(account_id uuid, limit integer)",
    );
    expect(routineCallTemplate("public", routine)).toBe(
      "SELECT public.find_orders(account_id, limit);",
    );
  });

  it("uses CALL only for procedures and provides stable placeholders", () => {
    const routine = {
      name: "archive_orders",
      routine_type: "PROCEDURE",
      parameters: [{ name: "" as string, data_type: "date" }],
      return_type: "",
    };

    expect(routineKind(routine)).toBe("procedure");
    expect(routineKindLabel(routine)).toBe("proc");
    expect(routineCallTemplate("ops", routine)).toBe(
      "CALL ops.archive_orders(arg1);",
    );
  });
});

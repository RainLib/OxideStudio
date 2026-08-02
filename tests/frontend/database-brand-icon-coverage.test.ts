import { describe, expect, it } from "vitest";
import { hasDatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import { REFERENCE_DATABASE_DRIVER_CANDIDATES } from "@/features/database-drivers";

describe("database brand icon coverage", () => {
  it("keeps every reference driver identifiable in all shared picker surfaces", () => {
    const missing = REFERENCE_DATABASE_DRIVER_CANDIDATES
      .filter((candidate) => !hasDatabaseBrandIcon(candidate.driver))
      .map((candidate) => candidate.driver);

    expect(missing).toEqual([]);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { targetBinding } from "./print-enterprise-target-binding.mjs";

test("target binding ignores credentials and query parameters", () => {
  const expected = "019748c95a03a9189e9ca261cb27df2f9ca940f4f33219672ee4197e431cf4d1";
  assert.equal(
    targetBinding("postgresql", "postgres://reader:secret@db.example.test/analytics?sslmode=verify-full"),
    expected,
  );
  assert.equal(
    targetBinding("postgres", "postgres://other:rotated@db.example.test/analytics?token=secret"),
    expected,
  );
});

test("target binding rejects unknown drivers and hostless URLs", () => {
  assert.throws(() => targetBinding("sqlite", "sqlite:///tmp/app.db"));
  assert.throws(() => targetBinding("postgres", "postgres:///analytics"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateSigningEnvironment } from "./release-macos.mjs";

const environment = {
  APPLE_ID: "release@example.invalid",
  APPLE_PASSWORD: "test-placeholder",
  APPLE_TEAM_ID: "TEST123456",
  APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (TEST123456)",
};

test("accepts complete Developer ID configuration", () => {
  assert.doesNotThrow(() => validateSigningEnvironment(environment));
});

test("rejects incomplete credentials without exposing the configured password", () => {
  assert.throws(() => validateSigningEnvironment({ ...environment, APPLE_ID: "" }), error => {
    assert.match(error.message, /APPLE_ID/);
    assert.ok(!error.message.includes(environment.APPLE_PASSWORD));
    return true;
  });
});

test("rejects development certificates for public distribution", () => {
  assert.throws(() => validateSigningEnvironment({ ...environment,
    APPLE_SIGNING_IDENTITY: "Apple Development: Test (TEST123456)",
  }), /Developer ID Application/);
});

test("rejects a certificate from another Apple team", () => {
  assert.throws(() => validateSigningEnvironment({ ...environment,
    APPLE_TEAM_ID: "OTHER12345",
  }), /must match/);
});

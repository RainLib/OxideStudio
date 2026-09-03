import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDesktopConfigDirectory,
  localDatabaseUrl,
  parseArguments,
  parseEnvFile,
} from "./bootstrap-enterprise-local.mjs";
import { targetBinding } from "./print-enterprise-target-binding.mjs";

test("enterprise local bootstrap parses quoted deployment variables", () => {
  assert.deepEqual(
    parseEnvFile("# local\nPOSTGRES_PASSWORD='secret value'\nCASDOOR_CLIENT_ID=client-1\n"),
    {
      POSTGRES_PASSWORD: "secret value",
      CASDOOR_CLIENT_ID: "client-1",
    },
  );
});

test("enterprise local bootstrap resolves the Windows desktop account directory", () => {
  assert.equal(
    defaultDesktopConfigDirectory({ APPDATA: "C:\\Profiles\\Ada" }, "win32"),
    "C:\\Profiles\\Ada\\com.houshuai.oxide-studio\\enterprise",
  );
});

test("enterprise local bootstrap rejects placeholder credentials", () => {
  assert.throws(
    () => localDatabaseUrl({ POSTGRES_PASSWORD: "replace-with-a-long-random-password" }),
    /POSTGRES_PASSWORD must be configured/,
  );
  assert.equal(
    localDatabaseUrl({ POSTGRES_PASSWORD: "p@ss word" }),
    "postgres://oxide:p%40ss%20word@postgres:5432/oxide_enterprise?sslmode=disable",
  );
});

test("enterprise target binding canonicalizes the PostgreSQL default port", () => {
  assert.equal(
    targetBinding("postgres", "postgres://reader:secret@db.example.test/analytics"),
    targetBinding(
      "postgres",
      "postgres://reader:secret@db.example.test:5432/analytics",
    ),
  );
});

test("enterprise local bootstrap validates organization scope", () => {
  assert.throws(
    () => parseArguments(["--organization-id", "not-a-uuid"]),
    /organization id must be a UUID/,
  );
  assert.equal(
    parseArguments([
      "--organization-id",
      "386f9632-7ac7-4fd3-974c-58716b66e988",
      "--reset-certificates",
    ]).resetCertificates,
    true,
  );
});

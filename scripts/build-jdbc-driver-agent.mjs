#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src-tauri", "jdbc-agent", "src");
const output = resolve(process.argv[2] || join(root, "artifacts", "jdbc-agent"));
const classes = join(output, "classes");
const jar = join(output, "oxide-jdbc-agent.jar");
const javaHome = process.env.OXIDE_JAVA_HOME?.trim() || process.env.JAVA_HOME?.trim();
const javaTool = (name) => javaHome
  ? join(resolve(javaHome), "bin", process.platform === "win32" ? `${name}.exe` : name)
  : name;
async function files(directory) { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat(); }
await rm(classes, { recursive: true, force: true }); await mkdir(classes, { recursive: true });
execFileSync(javaTool("javac"), ["--release", "21", "-d", classes, ...(await files(source))], { stdio: "inherit" });
execFileSync(javaTool("jar"), ["--create", "--file", jar, "--main-class", "studio.oxide.jdbc.DriverMain", "-C", classes, "."], { stdio: "inherit" });
console.log(jar);

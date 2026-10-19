import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignoredDirectories = new Set([".git", ".local", ".omc", ".tmp", "node_modules"]);
const sourceFiles = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collect(join(directory, entry.name));
    } else if (entry.isFile() && [".js", ".mjs", ".cjs"].includes(extname(entry.name))) {
      sourceFiles.push(join(directory, entry.name));
    }
  }
}

await collect(projectDir);
sourceFiles.sort();
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checked ${sourceFiles.length} JavaScript module(s).`);

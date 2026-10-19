#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

function runServer(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(appDir, "server.mjs"), ...args], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", code => resolvePromise(code ?? 0));
  });
}

/**
 * Run the preview server, restarting it when the web setup page asks for it
 * (server exit code 75). The child owns the HTTP socket so a restart is safe.
 */
export async function runPreview({ args = [], open = true } = {}) {
  let restarts = 0;
  while (true) {
    const passArgs = [...args];
    if (open && restarts === 0 && !passArgs.includes("--no-open")) passArgs.push("--open");
    const code = await runServer(passArgs);
    if (code === 75 && restarts < 5) {
      restarts += 1;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
      continue;
    }
    process.exitCode = code;
    return;
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMain()) {
  await runPreview({ args: process.argv.slice(2), open: !process.argv.includes("--no-open") });
}

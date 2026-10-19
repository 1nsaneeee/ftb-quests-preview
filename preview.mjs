#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
let activeServerChild;

function runServer(args, { clearSourceEnvironment = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    if (clearSourceEnvironment) {
      for (const key of Object.keys(env)) {
        if (["QUEST_PREVIEW_INSTANCE_ROOT", "QUEST_PREVIEW_DATA_DIR"].includes(key.toUpperCase())) delete env[key];
      }
    }
    const child = spawn(process.execPath, [join(appDir, "server.mjs"), ...args], {
      env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    activeServerChild = child;
    let setupConfigPath;
    child.on("message", message => {
      if (message?.type === "setup-restart" && typeof message.configPath === "string") {
        setupConfigPath = message.configPath;
      }
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (activeServerChild === child) activeServerChild = undefined;
      resolvePromise({ code: code ?? 0, setupConfigPath });
    });
  });
}

function setupRestartArgs(args, configPath) {
  const nextArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--demo") continue;
    if (["--instance-root", "--data-dir", "--config"].includes(token)) {
      index += 1;
      continue;
    }
    nextArgs.push(token);
  }
  return [...nextArgs, "--config", configPath];
}

/**
 * Run the preview server, restarting it when the web setup page asks for it
 * (server exit code 75). The child owns the HTTP socket so a restart is safe.
 */
export async function runPreview({ args = [], open = true } = {}) {
  let restarts = 0;
  let currentArgs = [...args];
  let clearSourceEnvironment = false;
  let stopRequested = false;
  const stopServer = signal => {
    stopRequested = true;
    activeServerChild?.kill(signal);
  };
  const stopOnInterrupt = () => stopServer("SIGINT");
  const stopOnTerminate = () => stopServer("SIGTERM");
  process.on("SIGINT", stopOnInterrupt);
  process.on("SIGTERM", stopOnTerminate);
  try {
    while (true) {
      const passArgs = [...currentArgs];
      if (open && restarts === 0 && !passArgs.includes("--no-open")) passArgs.push("--open");
      const { code, setupConfigPath } = await runServer(passArgs, { clearSourceEnvironment });
      if (stopRequested) {
        process.exitCode = code;
        return;
      }
      if (code === 75 && restarts < 5) {
        if (setupConfigPath) {
          currentArgs = setupRestartArgs(currentArgs, setupConfigPath);
          clearSourceEnvironment = true;
        }
        restarts += 1;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
        continue;
      }
      process.exitCode = code;
      return;
    }
  } finally {
    process.off("SIGINT", stopOnInterrupt);
    process.off("SIGTERM", stopOnTerminate);
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

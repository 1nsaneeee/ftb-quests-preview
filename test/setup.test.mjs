import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const fixtureQuestDir = join(projectDir, "fixtures", "quests");

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(t, args) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(projectDir, "server.mjs"), ...args], {
    cwd: projectDir,
    env: { ...process.env, QUEST_PREVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await once(child, "exit");
  });
  const deadline = Date.now() + 5000;
  while (!output.includes("Quest preview ready") && child.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(output, /Quest preview ready/, output);
  return { base: `http://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, port, child };
}

async function startPreview(t, { appDir = projectDir, cwd, args, env = {} }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(appDir, "preview.mjs"), ...args, "--no-open"], {
    cwd,
    env: { ...process.env, ...env, QUEST_PREVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const childExit = once(child, "exit");
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
  const deadline = Date.now() + 8000;
  while (!output.includes("Quest preview ready") && child.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!output.includes("Quest preview ready")) {
    const exitCode = child.exitCode;
    await stopPreviewProcess(child, childExit);
    throw new Error(`preview wrapper failed to become ready (exit ${exitCode ?? child.exitCode}): ${output || "<no output>"}`);
  }
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    child,
    getOutput: () => output,
    async stop() {
      await stopPreviewProcess(child, childExit);
      await waitForPortClosed(`http://127.0.0.1:${port}`);
    },
  };
}

async function stopPreviewProcess(child, childExit) {
  if (child.exitCode === null && process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await once(killer, "exit");
  } else if (child.exitCode === null) {
    child.kill();
  }
  if (child.exitCode === null) await childExit;
}

async function waitForPortClosed(base) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/setup`, { signal: AbortSignal.timeout(250) });
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`preview still listening at ${base}`);
}

async function makeNamedQuestData(root, label) {
  const dataDir = join(root, label);
  await cp(fixtureQuestDir, dataDir, { recursive: true });
  const localePath = join(dataDir, "lang", "en_us.snbt");
  const locale = await readFile(localePath, "utf8");
  await writeFile(localePath, locale.replace("First steps", label));
  return dataDir;
}

async function firstQuestTitle(base) {
  const response = await fetch(`${base}/api/data?locale=en_us`, { signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new Error(`preview data request failed with HTTP ${response.status}`);
  const data = await response.json();
  return data.chapters[0].quests[0].title;
}

async function waitForTitle(server, expected) {
  const deadline = Date.now() + 8_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`preview wrapper exited ${server.child.exitCode}: ${server.getOutput()}`);
    try {
      const title = await firstQuestTitle(server.base);
      if (title === expected) return;
      lastError = new Error(`expected '${expected}', got '${title}'`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error(`preview did not serve '${expected}'`);
}

async function selectDataSource(base, dataDir) {
  const response = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ mode: "data", dataDir }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).restart, true);
}

async function makeTemporaryPackage(root) {
  const appDir = join(root, "node_modules", "ftb-quests-preview");
  await mkdir(join(appDir, "node_modules"), { recursive: true });
  for (const name of ["preview.mjs", "server.mjs", "parse-snbt.mjs"]) {
    await cp(join(projectDir, name), join(appDir, name));
  }
  for (const name of ["server", "fixtures"]) {
    await cp(join(projectDir, name), join(appDir, name), { recursive: true });
  }
  return appDir;
}

test("first-run setup writes config, restarts, and then serves data", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  const dataDir = join(root, "quests");
  await cp(fixtureQuestDir, dataDir, { recursive: true });

  const first = await startServer(t, ["--config", configPath]);
  const setup = await (await fetch(`${first.base}/api/setup`)).json();
  assert.equal(setup.needsSetup, true);
  assert.equal(setup.configPath, configPath);

  const response = await fetch(`${first.base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: first.origin },
    body: JSON.stringify({ mode: "data", dataDir }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, restart: true, configPath });
  if (first.child.exitCode === null) {
    await Promise.race([
      once(first.child, "exit"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("server did not request restart")), 5000)),
    ]);
  }
  assert.equal(first.child.exitCode, 75);
  const written = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(written.mode, "instance");
  assert.equal(written.dataDir, dataDir);

  const second = await startServer(t, ["--config", configPath]);
  const data = await (await fetch(`${second.base}/api/data?locale=en_us`)).json();
  assert.equal(data.locale, "en_us");
  assert.equal(data.chapters.length, 1);
  assert.equal(data.chapters[0].quests.length, 2);
});

test("setup rejects a missing directory without writing config", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  const server = await startServer(t, ["--config", configPath]);
  const response = await fetch(`${server.base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.origin },
    body: JSON.stringify({ mode: "data", dataDir: join(root, "missing") }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "setup_invalid");
  await assert.rejects(readFile(configPath, "utf8"));
});

test("web setup replaces a CLI source, then supports another source switch", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-setup-wrapper-"));
  let server;
  t.after(async () => {
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });
  const cwd = join(root, "cwd");
  await mkdir(cwd, { recursive: true });
  const oldData = await makeNamedQuestData(root, "CLI source");
  const newData = await makeNamedQuestData(root, "web source");
  const configPath = join(root, "explicit-config.json");
  server = await startPreview(t, {
    cwd,
    args: ["--data-dir", oldData, "--config", configPath],
  });

  assert.equal(await firstQuestTitle(server.base), "CLI source");
  await selectDataSource(server.base, newData);
  await waitForTitle(server, "web source");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).dataDir, newData);

  await selectDataSource(server.base, oldData);
  await waitForTitle(server, "CLI source");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).dataDir, oldData);
});

test("web setup clears an environment data source only for the restarted wrapper child", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-setup-env-"));
  let server;
  t.after(async () => {
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });
  const cwd = join(root, "cwd");
  await mkdir(cwd, { recursive: true });
  const oldData = await makeNamedQuestData(root, "env source");
  const newData = await makeNamedQuestData(root, "web source");
  const configPath = join(root, "explicit-config.json");
  const sourceEnv = process.platform === "win32"
    ? { quest_preview_data_dir: oldData }
    : { QUEST_PREVIEW_DATA_DIR: oldData };
  server = await startPreview(t, {
    cwd,
    args: ["--config", configPath],
    env: sourceEnv,
  });

  assert.equal(await firstQuestTitle(server.base), "env source");
  await selectDataSource(server.base, newData);
  await waitForTitle(server, "web source");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).dataDir, newData);
  await selectDataSource(server.base, oldData);
  await waitForTitle(server, "env source");
});

test("web setup switches from demo to temporary real data and keeps explicit config active", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-setup-demo-"));
  let server;
  t.after(async () => {
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });
  const cwd = join(root, "cwd");
  await mkdir(cwd, { recursive: true });
  const appDir = await makeTemporaryPackage(root);
  const newData = await makeNamedQuestData(root, "web source");
  const configPath = join(root, "explicit-config.json");
  const cacheEnv = process.platform === "win32"
    ? { LOCALAPPDATA: join(root, "local-app-data") }
    : process.platform === "darwin"
      ? { HOME: join(root, "home") }
      : { XDG_CACHE_HOME: join(root, "cache") };
  const demoCopy = process.platform === "win32"
    ? join(root, "local-app-data", "ftb-quests-preview", "demo-quests")
    : process.platform === "darwin"
      ? join(root, "home", "Library", "Caches", "ftb-quests-preview", "demo-quests")
      : join(root, "cache", "ftb-quests-preview", "demo-quests");
  server = await startPreview(t, {
    appDir,
    cwd,
    args: ["--demo", "--config", configPath],
    env: cacheEnv,
  });

  assert.equal(await firstQuestTitle(server.base), "First steps");
  await selectDataSource(server.base, newData);
  await waitForTitle(server, "web source");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).dataDir, newData);
  assert.equal(await readFile(join(demoCopy, "lang", "en_us.snbt"), "utf8").then(value => value.includes("First steps")), true);
});

test("an occupied port fails without opening the unrelated service", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-port-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "cwd");
  await mkdir(cwd, { recursive: true });
  const marker = join(root, "opener-called.txt");
  const preload = join(root, "stub-opener.mjs");
  await writeFile(preload, [
    'import childProcess from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'const realSpawn = childProcess.spawn;',
    'childProcess.spawn = (command, args, options) => {',
    '  if (command === "cmd" || command === "open" || command === "xdg-open") {',
    '    writeFileSync(process.env.QUEST_PREVIEW_OPEN_MARKER, String(command));',
    '    return { on() { return this; }, unref() {} };',
    '  }',
    '  return realSpawn(command, args, options);',
    '};',
    'syncBuiltinESMExports();',
    "",
  ].join("\n"));
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const port = occupied.address().port;
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, join(projectDir, "preview.mjs"), "--open"], {
    cwd,
    env: { ...process.env, QUEST_PREVIEW_PORT: String(port), QUEST_PREVIEW_OPEN_MARKER: marker },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
  const [code] = await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`preview did not exit: ${output}`)), 5_000)),
  ]);
  await new Promise((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));

  assert.equal(code, 1, output);
  assert.match(output, /port.*in use/i);
  assert.doesNotMatch(output, /opening the existing preview/i);
  await assert.rejects(readFile(marker, "utf8"));
});

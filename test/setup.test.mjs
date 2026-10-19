import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

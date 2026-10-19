import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPreviewConfig } from "../server/config.mjs";

async function makeQuestDir(path, { lang = false } = {}) {
  await mkdir(join(path, "chapters"), { recursive: true });
  if (lang) await mkdir(join(path, "lang"), { recursive: true });
}

test("requires setup when no source is configured and accepts explicit demo and inline-only data", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const fixture = join(projectDir, "fixtures", "quests");
  const cwd = join(root, "empty");
  const configPath = join(root, "missing-config.json");
  await makeQuestDir(fixture);
  await mkdir(cwd, { recursive: true });

  const unconfigured = await loadPreviewConfig({ argv: [], env: {}, cwd, projectDir, fixtureQuestDir: fixture, configPath });
  assert.equal(unconfigured.needsSetup, true);
  assert.equal(unconfigured.questDir, null);
  assert.equal(unconfigured.configPath, configPath);

  const demo = await loadPreviewConfig({ argv: ["--demo"], env: {}, cwd, projectDir, fixtureQuestDir: fixture, configPath });
  assert.equal(demo.isDemo, true);
  assert.equal(demo.questDir, resolve(fixture));
  assert.equal(demo.source, "cli");

  const inlineData = join(root, "inline-data");
  await makeQuestDir(inlineData);
  const configured = await loadPreviewConfig({
    argv: ["--data-dir", inlineData], env: {}, cwd, projectDir, fixtureQuestDir: fixture, configPath,
  });
  assert.equal(configured.isDemo, false);
  assert.equal(configured.questDir, resolve(inlineData));
  assert.equal(configured.source, "cli");
});

test("resolves config paths from project directory and applies CLI over environment over config", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const fixture = join(projectDir, "fixtures", "quests");
  const cwd = join(root, "cwd");
  const configInstance = join(root, "config-instance");
  const cliInstance = join(root, "cli-instance");
  const configData = join(root, "config-data");
  const envData = join(root, "env-data");
  for (const directory of [fixture, join(configInstance, "config", "ftbquests", "quests"),
    join(cliInstance, "config", "ftbquests", "quests"), configData, envData]) {
    await makeQuestDir(directory);
  }
  await mkdir(cwd, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "quest-preview.local.json"), JSON.stringify({
    version: 1,
    mode: "instance",
    instanceRoot: "../config-instance",
    dataDir: "../config-data",
  }));

  const configPath = join(projectDir, "quest-preview.local.json");
  const fromConfig = await loadPreviewConfig({ argv: [], env: {}, cwd, projectDir, fixtureQuestDir: fixture, configPath });
  assert.equal(fromConfig.instanceRoot, resolve(configInstance));
  assert.equal(fromConfig.questDir, resolve(configData));
  assert.equal(fromConfig.source, "local-config");

  const fromEnvAndCli = await loadPreviewConfig({
    argv: ["--instance-root", "../cli-instance"],
    env: { QUEST_PREVIEW_DATA_DIR: "../env-data" },
    cwd,
    projectDir,
    fixtureQuestDir: fixture,
    configPath,
  });
  assert.equal(fromEnvAndCli.instanceRoot, resolve(cwd, "../cli-instance"));
  assert.equal(fromEnvAndCli.questDir, resolve(cwd, "../env-data"));
  assert.equal(fromEnvAndCli.source, "cli");
});

test("explicit missing paths fail instead of silently selecting the fixture", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const fixture = join(projectDir, "fixtures", "quests");
  await makeQuestDir(fixture);
  await mkdir(projectDir, { recursive: true });
  await assert.rejects(loadPreviewConfig({
    argv: ["--instance-root", join(root, "missing-instance")],
    env: {},
    cwd: root,
    projectDir,
    fixtureQuestDir: fixture,
    configPath: join(root, "missing-config.json"),
  }), /does not exist/);
});

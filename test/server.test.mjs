import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { revisionHash, saveQuestChanges } from "../server/save-service.mjs";

const projectDir = fileURLToPath(new URL("..", import.meta.url));

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
    child.kill();
    if (child.exitCode === null) await once(child, "exit");
  });
  const deadline = Date.now() + 5000;
  while (!output.includes("Quest preview ready") && child.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(output, /Quest preview ready/, output);
  return { base: `http://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}

test("/api/data includes localized chapter groups without assigning ungrouped chapters", async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), "quest-preview-groups-api-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const questDir = join(tempRoot, "quests");
  await mkdir(join(questDir, "chapters"), { recursive: true });
  await mkdir(join(questDir, "lang"), { recursive: true });
  await writeFile(join(questDir, "chapter_groups.snbt"), '[{ id: "group-a" title: "Inline group" }]');
  await writeFile(join(questDir, "chapters", "a-grouped.snbt"), '{ id: "grouped" group: "group-a" quests: [] }');
  await writeFile(join(questDir, "chapters", "b-ungrouped.snbt"), '{ id: "ungrouped" quests: [] }');
  await writeFile(join(questDir, "lang", "en_us.snbt"), '{ "chapter_group.group-a.title": "English group" }');
  await writeFile(join(questDir, "lang", "zh_cn.snbt"), '{ "chapter_group.group-a.title": "中文分组" }');
  const server = await startServer(t, ["--data-dir", questDir]);

  const response = await fetch(`${server.base}/api/data?locale=zh_cn`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.chapterGroups, [{ id: "group-a", title: "中文分组" }]);
  assert.deepEqual(payload.chapters.map(chapter => [chapter.id, chapter.group]), [
    ["grouped", "group-a"],
    ["ungrouped", null],
  ]);
});

function postHeaders(server, token, origin = server.origin) {
  return { "content-type": "application/json", origin, "x-quest-preview-token": token };
}

function requestWithHost(server, host) {
  const port = Number(new URL(server.base).port);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/api/data", headers: { Host: host } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
}

test("serves graph metadata and saves only selected quest fields with byte backups", async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), "quest-preview-save-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const questDir = join(tempRoot, "quests");
  await cp(join(projectDir, "fixtures", "quests"), questDir, { recursive: true });
  const chapterPath = join(questDir, "chapters", "demo-a.snbt");
  const original = await readFile(chapterPath, "utf8");
  const source = `\uFEFF${original.replaceAll("\n", "\r\n").replace("id: \"demo_first\"", 'id: "demo_first"\r\n\t\t\t# retained\r\n\t\t\tunknown_field: [alpha, beta]')}`;
  const originalBytes = Buffer.from(source, "utf8");
  await writeFile(chapterPath, originalBytes);
  const server = await startServer(t, ["--data-dir", questDir]);

  assert.equal(await requestWithHost(server, "evil.example"), 403);

  const response = await fetch(`${server.base}/api/data?locale=zh_cn`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.defaultQuestShape, "circle");
  assert.equal(payload.gridScale, 0.5);
  const chapter = payload.chapters.find(item => item.id === "demo_a");
  assert.equal(chapter.defaultQuestSize, 1);
  assert.equal(chapter.images[0].width, 3);
  const quest = chapter.quests.find(item => item.id === "demo_second");
  assert.deepEqual(quest.dependencies, ["demo_first"]);
  assert.equal(quest.x, 2.5);
  assert.equal(quest.width, null);
  const first = chapter.quests.find(item => item.id === "demo_first");
  assert.equal(first.subtitle, "来自语言文件的副标题");
  assert.equal(payload.editing.enabled, true);
  assert.equal(typeof payload.editing.token, "string");
  assert.equal((await fetch(`${server.base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${server.base}/`)).status, 200);
  assert.equal((await fetch(`${server.base}/components/quest-map.js`)).status, 200);
  const traversal = encodeURIComponent("minecraft:../../server.mjs");
  assert.equal((await fetch(`${server.base}/api/asset?location=${traversal}`)).status, 400);

  const badOrigin = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, payload.editing.token, "https://evil.example"),
    body: JSON.stringify({ locale: "zh_cn", revisions: payload.editing.revisions, changes: [{ questId: "demo_first", x: 1 }] }),
  });
  assert.equal(badOrigin.status, 403);
  const badToken = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, "wrong"),
    body: JSON.stringify({ locale: "zh_cn", revisions: payload.editing.revisions, changes: [{ questId: "demo_first", x: 1 }] }),
  });
  assert.equal(badToken.status, 403);
  const badId = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, payload.editing.token),
    body: JSON.stringify({ locale: "zh_cn", revisions: payload.editing.revisions, changes: [{ questId: "../outside", x: 1 }] }),
  });
  assert.equal(badId.status, 400);
  const badLocale = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, payload.editing.token),
    body: JSON.stringify({ locale: "../../outside", revisions: payload.editing.revisions, changes: [{ questId: "demo_first", x: 1 }] }),
  });
  assert.equal(badLocale.status, 400);

  const saved = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, payload.editing.token),
    body: JSON.stringify({
      locale: "zh_cn",
      revisions: payload.editing.revisions,
      changes: [{ questId: "demo_first", x: 1.5, title: "QA 标题", subtitle: "副标题", description: ["line one", "line two"] }],
    }),
  });
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.saved, true);
  assert.equal(result.data.chapters[0].quests[0].x, 1.5);
  assert.equal(result.data.chapters[0].quests[0].title, "QA 标题");
  assert.equal(result.data.chapters[0].quests[0].subtitle, "副标题");
  assert.deepEqual(result.data.chapters[0].quests[0].description, ["line one", "line two"]);
  const changed = await readFile(chapterPath, "utf8");
  assert.ok(changed.startsWith("\uFEFF"));
  assert.ok(changed.includes("\r\n"));
  assert.match(changed, /# retained/);
  assert.match(changed, /unknown_field: \[alpha, beta\]/);
  assert.match(changed, /x: 1\.5/);
  const localePath = join(questDir, "lang", "zh_cn.snbt");
  const localeSource = await readFile(localePath, "utf8");
  assert.match(localeSource, /"quest\.demo_first\.title": "QA 标题"/);
  assert.match(localeSource, /"quest\.demo_first\.quest_subtitle": "副标题"/);
  assert.match(localeSource, /"quest\.demo_first\.quest_desc": \["line one","line two"\]/);
  const backupDir = join(questDir, result.backups[0]);
  assert.deepEqual(await readFile(join(backupDir, "chapters", "demo-a.snbt")), originalBytes);
  assert.deepEqual(await readFile(join(backupDir, "lang", "zh_cn.snbt")), await readFile(join(projectDir, "fixtures", "quests", "lang", "zh_cn.snbt")));
  const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
  assert.equal(manifest.files.every(entry => entry.originalExists), true);

  const fresh = await (await fetch(`${server.base}/api/data?locale=zh_cn`)).json();
  const localeBeforeConflict = await readFile(localePath);
  await writeFile(chapterPath, Buffer.concat([await readFile(chapterPath), Buffer.from("\r\n# external edit\r\n")]));
  const conflict = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, fresh.editing.token),
    body: JSON.stringify({ locale: "zh_cn", revisions: fresh.editing.revisions, changes: [{ questId: "demo_first", x: 9, title: "must not write" }] }),
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await readFile(localePath), localeBeforeConflict);
});

test("supports inline-only chapters without a locale directory and creates the selected locale on save", async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), "quest-preview-inline-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const questDir = join(tempRoot, "quests");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(questDir, "chapters"), { recursive: true }));
  await writeFile(join(questDir, "chapters", "inline.snbt"), '{ id: "inline" quests: [{ id: "inline-q" title: "Inline title" subtitle: "Inline sub" quest_desc: ["inline body"] x: 0 y: 0 }] }');
  const server = await startServer(t, ["--data-dir", questDir]);
  const response = await fetch(`${server.base}/api/data`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.locale, "en_us");
  assert.equal(payload.chapters[0].quests[0].title, "Inline title");
  assert.equal(payload.chapters[0].quests[0].subtitle, "Inline sub");
  assert.deepEqual(payload.chapters[0].quests[0].description, ["inline body"]);
  assert.equal(payload.editing.revisions["lang/en_us.snbt"], null);

  const saved = await fetch(`${server.base}/api/save`, {
    method: "POST", headers: postHeaders(server, payload.editing.token),
    body: JSON.stringify({ locale: "en_us", revisions: payload.editing.revisions, changes: [{ questId: "inline-q", title: "Locale override" }] }),
  });
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.data.chapters[0].quests[0].title, "Locale override");
  const manifest = JSON.parse(await readFile(join(questDir, result.backups[0], "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files, [{ path: "lang/en_us.snbt", originalExists: false, backupPath: null }]);
  assert.match(await readFile(join(questDir, "lang", "en_us.snbt"), "utf8"), /"quest\.inline-q\.title": "Locale override"/);
});

test("does not report success and restores earlier files when a later file commit fails", async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), "quest-preview-rollback-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const questDir = join(tempRoot, "quests");
  const chapterDir = join(questDir, "chapters");
  const localeDir = join(questDir, "lang");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(chapterDir, { recursive: true });
  await mkdir(localeDir, { recursive: true });
  const first = Buffer.from('{ id: "a" quests: [{ id: "q1" x: 0 y: 0 }] }');
  const second = Buffer.from('{ id: "b" quests: [{ id: "q2" x: 1 y: 1 }] }');
  const firstPath = join(chapterDir, "a.snbt");
  const secondPath = join(chapterDir, "b.snbt");
  await writeFile(firstPath, first);
  await writeFile(secondPath, second);
  let renameCount = 0;
  await assert.rejects(saveQuestChanges({
    questDir,
    chapterDir,
    localeDir,
    locale: "en_us",
    locales: ["en_us"],
    revisions: { "chapters/a.snbt": revisionHash(first), "chapters/b.snbt": revisionHash(second) },
    changes: [{ questId: "q1", x: 5 }, { questId: "q2", y: 9 }],
    renameFile: async (from, to) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error("simulated second-file commit failure");
      const { rename } = await import("node:fs/promises");
      return rename(from, to);
    },
  }), /Save failed; committed files were restored/);
  assert.deepEqual(await readFile(firstPath), first);
  assert.deepEqual(await readFile(secondPath), second);
});

test("detects an external edit after staging and writes no target file", async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), "quest-preview-conflict-window-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const questDir = join(tempRoot, "quests");
  const chapterDir = join(questDir, "chapters");
  const localeDir = join(questDir, "lang");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(chapterDir, { recursive: true });
  await mkdir(localeDir, { recursive: true });
  const original = Buffer.from('{ id: "c" quests: [{ id: "q" x: 0 y: 0 }] }');
  const chapterPath = join(chapterDir, "c.snbt");
  await writeFile(chapterPath, original);
  await assert.rejects(saveQuestChanges({
    questDir,
    chapterDir,
    localeDir,
    locale: "en_us",
    locales: ["en_us"],
    revisions: { "chapters/c.snbt": revisionHash(original), "lang/en_us.snbt": null },
    changes: [{ questId: "q", x: 3 }],
    beforeCommit: () => writeFile(chapterPath, Buffer.concat([original, Buffer.from(" # external")]))
  }), error => error.code === "REVISION_CONFLICT");
  assert.deepEqual(await readFile(chapterPath), Buffer.concat([original, Buffer.from(" # external")]));
});

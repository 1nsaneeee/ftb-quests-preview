import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep, resolve } from "node:path";
import { parseSnbt } from "../parse-snbt.mjs";
import { patchLocaleSnbt, patchQuestSnbt } from "./snbt-edit.mjs";
import { diffLines } from "./diff.mjs";

const MAX_CHANGES = 100;
const MAX_TEXT = 8_000;
const MAX_DESCRIPTION_LINES = 200;
const COORDINATE_LIMIT = 10_000;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const within = (base, target) => {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function revisionConflict(relativePath, expectedRevision, actualRevision) {
  return Object.assign(new Error(`Revision conflict: ${relativePath}`), {
    code: "REVISION_CONFLICT",
    relativePath,
    expectedRevision: expectedRevision ?? null,
    actualRevision: actualRevision ?? null,
  });
}

function validateLocale(locale, locales) {
  return typeof locale === "string" && locales.includes(locale) && /^[a-zA-Z0-9_-]{2,32}$/.test(locale);
}

function validateChanges(changes, locales, locale) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) throw new TypeError("Invalid changes");
  if (!validateLocale(locale, locales)) throw new TypeError("Invalid locale");
  const seen = new Set();
  return changes.map(change => {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new TypeError("Invalid change");
    const allowed = new Set(["questId", "x", "y", "title", "subtitle", "description"]);
    if (Object.keys(change).some(key => !allowed.has(key)) || typeof change.questId !== "string"
      || change.questId.length < 1 || change.questId.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(change.questId)) throw new TypeError("Invalid quest change");
    if (seen.has(change.questId)) throw new TypeError("Duplicate quest change");
    seen.add(change.questId);
    const fields = { ...change };
    delete fields.questId;
    if (Object.keys(fields).length < 1) throw new TypeError("Empty quest change");
    for (const key of ["x", "y"]) {
      if (Object.hasOwn(fields, key) && (typeof fields[key] !== "number" || !Number.isFinite(fields[key]) || Math.abs(fields[key]) > COORDINATE_LIMIT || Number(fields[key].toFixed(6)) !== fields[key])) throw new TypeError("Invalid coordinate");
    }
    for (const key of ["title", "subtitle"]) {
      if (Object.hasOwn(fields, key) && (typeof fields[key] !== "string" || fields[key].length > MAX_TEXT)) throw new TypeError("Invalid text");
    }
    if (Object.hasOwn(fields, "description")) {
      if (!Array.isArray(fields.description) || fields.description.length > MAX_DESCRIPTION_LINES || fields.description.some(line => typeof line !== "string" || line.length > MAX_TEXT)) throw new TypeError("Invalid description");
      fields.quest_desc = fields.description;
      delete fields.description;
    }
    return { questId: change.questId, fields };
  });
}

async function safeExisting(base, target, expectedType) {
  const absolute = resolve(target);
  if (!within(base, absolute)) throw new Error("Target outside quest data directory");
  const details = await lstat(absolute);
  if (details.isSymbolicLink()) throw new Error("Symlink targets are not editable");
  const resolved = await realpath(absolute);
  if (!within(base, resolved)) throw new Error("Target outside quest data directory");
  const resolvedDetails = await stat(resolved);
  if (expectedType === "file" && !resolvedDetails.isFile()) throw new Error("Expected a file");
  if (expectedType === "directory" && !resolvedDetails.isDirectory()) throw new Error("Expected a directory");
  return resolved;
}

async function safeLocaleTarget(questRoot, localeDir, file) {
  try {
    await safeExisting(questRoot, file, "file");
    return { path: file, exists: true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await safeExisting(questRoot, localeDir, "directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { path: file, exists: false };
}

async function ensureBackupRoot(questRoot) {
  const path = join(questRoot, ".quest-preview-backups");
  try {
    await safeExisting(questRoot, path, "directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path, { recursive: false });
    await safeExisting(questRoot, path, "directory");
  }
  return path;
}

async function writeBackup(questRoot, targets) {
  const backupRoot = await ensureBackupRoot(questRoot);
  const folderName = `${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}`;
  const folder = join(backupRoot, folderName);
  await mkdir(folder, { recursive: false });
  const manifestFiles = [];
  for (const target of targets) {
    const backupPath = target.exists ? join(folder, target.relativePath) : null;
    if (target.exists) {
      await mkdir(dirname(backupPath), { recursive: true });
      await writeFile(backupPath, target.originalBytes, { flag: "wx" });
    }
    manifestFiles.push({ path: target.relativePath, originalExists: target.exists, backupPath: target.exists ? target.relativePath : null });
  }
  await writeFile(join(folder, "manifest.json"), `${JSON.stringify({ createdAt: new Date().toISOString(), files: manifestFiles }, null, 2)}\n`, { flag: "wx" });
  return { folder, manifestFiles };
}

async function stage(target) {
  const temporary = join(dirname(target.path), `.quest-preview-${randomBytes(8).toString("hex")}.tmp`);
  try { await writeFile(temporary, target.nextBytes, { flag: "wx", mode: target.mode ?? 0o600 }); }
  catch (error) {
    await cleanupFile(temporary);
    throw error;
  }
  return temporary;
}

async function restore(target) {
  if (!target.exists) {
    await unlink(target.path).catch(error => { if (error.code !== "ENOENT") throw error; });
    return;
  }
  const temporary = join(dirname(target.path), `.quest-preview-rollback-${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temporary, target.originalBytes, { flag: "wx", mode: target.mode ?? 0o600 });
  try { await rename(temporary, target.path); }
  catch (error) {
    await cleanupFile(temporary);
    throw error;
  }
}

async function cleanupFile(path) {
  try { await unlink(path); }
  catch (error) {
    if (error.code !== "ENOENT") console.error("Quest save temporary cleanup failed", error.code ?? "cleanup_failed");
  }
}

async function verifyTargetUnchanged(questRoot, localeDir, target) {
  try {
    if (!target.exists) {
      const current = await safeLocaleTarget(questRoot, localeDir, target.path);
      if (current.exists) throw revisionConflict(target.relativePath, null, "present");
      return;
    }
    const safePath = await safeExisting(questRoot, target.path, "file");
    const currentBytes = await readFile(safePath);
    const actual = sha256(currentBytes);
    if (actual !== target.originalHash) throw revisionConflict(target.relativePath, target.originalHash, actual);
  } catch (error) {
    if (error.code === "REVISION_CONFLICT") throw error;
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw revisionConflict(target.relativePath, target.originalHash, null);
    throw error;
  }
}

export async function saveQuestChanges({ questDir, chapterDir, localeDir, locale, locales, revisions, changes, dryRun = false, renameFile = rename, beforeCommit = async () => {} }) {
  if (!revisions || typeof revisions !== "object" || Array.isArray(revisions)) throw new TypeError("Invalid revisions");
  const normalized = validateChanges(changes, locales, locale);
  const questRoot = await realpath(questDir);
  const chapterRoot = await safeExisting(questRoot, chapterDir, "directory");
  const chapterNames = (await readdir(chapterRoot)).filter(name => name.endsWith(".snbt")).sort();
  const questFiles = new Map();
  for (const name of chapterNames) {
    const filePath = join(chapterRoot, name);
    const safePath = await safeExisting(questRoot, filePath, "file");
    const bytes = await readFile(safePath);
    const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const data = parseSnbt(source, `chapters/${name}`);
    for (const quest of data.quests ?? []) {
      if (typeof quest.id !== "string") continue;
      if (questFiles.has(quest.id)) throw new Error("Duplicate quest id");
      questFiles.set(quest.id, { name, path: safePath });
    }
  }
  const chapterChanges = new Map();
  const localeChanges = new Map();
  for (const { questId, fields } of normalized) {
    const file = questFiles.get(questId);
    if (!file) throw new TypeError("Unknown quest id");
    const { x, y, title, subtitle, quest_desc: description } = fields;
    if (Object.hasOwn(fields, "x") || Object.hasOwn(fields, "y")) {
      if (!chapterChanges.has(file.name)) chapterChanges.set(file.name, []);
      chapterChanges.get(file.name).push({ questId, fields: Object.fromEntries(["x", "y"].filter(key => Object.hasOwn(fields, key)).map(key => [key, fields[key]])) });
    }
    for (const [key, value] of [["title", title], ["subtitle", subtitle], ["quest_desc", description]]) {
      if (value !== undefined) localeChanges.set(questId, { ...(localeChanges.get(questId) ?? {}), [key]: value });
    }
  }

  const targets = [];
  for (const [name, edits] of chapterChanges) {
    const relativePath = `chapters/${name}`;
    const path = join(chapterRoot, name);
    const safePath = await safeExisting(questRoot, path, "file");
    const originalBytes = await readFile(safePath);
    const expected = revisions[relativePath];
    const actual = sha256(originalBytes);
    if (typeof expected !== "string" || actual !== expected) throw revisionConflict(relativePath, expected, actual);
    const originalText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(originalBytes);
    let source = originalText;
    for (const edit of edits) source = patchQuestSnbt(source, edit.questId, edit.fields, relativePath);
    const nextBytes = Buffer.from(source, "utf8");
    if (nextBytes.equals(originalBytes)) continue;
    targets.push({ path: safePath, relativePath, exists: true, originalBytes, originalHash: sha256(originalBytes), nextBytes, originalText, nextText: source, mode: (await stat(safePath)).mode });
  }

  if (localeChanges.size > 0) {
    const localeName = `${locale}.snbt`;
    const targetPath = join(localeDir, localeName);
    let targetState = await safeLocaleTarget(questRoot, localeDir, targetPath);
    const relativePath = `lang/${localeName}`;
    let originalBytes = Buffer.from("", "utf8");
    let mode = 0o600;
    if (targetState.exists) {
      const safePath = await safeExisting(questRoot, targetPath, "file");
      originalBytes = await readFile(safePath);
      mode = (await stat(safePath)).mode;
    }
    const expected = revisions[relativePath] ?? null;
    const actual = targetState.exists ? sha256(originalBytes) : null;
    if (targetState.exists ? typeof expected !== "string" || actual !== expected : expected !== null) {
      throw revisionConflict(relativePath, expected, actual);
    }
    const originalText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(originalBytes);
    let source = originalText;
    if (!targetState.exists) source = `{${source ? `\n${source}\n` : ""}}`;
    for (const [questId, fields] of localeChanges) source = patchLocaleSnbt(source, questId, fields, relativePath);
    const nextBytes = Buffer.from(source, "utf8");
    if (!nextBytes.equals(originalBytes)) {
      targetState = await safeLocaleTarget(questRoot, localeDir, targetPath);
      targets.push({ path: targetPath, relativePath, exists: targetState.exists, originalBytes, originalHash: targetState.exists ? sha256(originalBytes) : null, nextBytes, originalText, nextText: source, mode });
    }
  }

  const describe = () => targets.map(target => {
    const diff = diffLines(target.originalText, target.nextText);
    return {
      path: target.relativePath,
      hunks: diff.hunks,
      truncated: diff.truncated,
      oldLines: diff.oldLines,
      newLines: diff.newLines,
    };
  });
  if (targets.length === 0) return { backups: [], changes: [], unchanged: true };

  // Recheck every destination after all source and request validation, before creating backups or staged files.
  for (const target of targets) {
    if (target.exists) await safeExisting(questRoot, target.path, "file");
    else {
      const parent = dirname(target.path);
      try { await safeExisting(questRoot, parent, "directory"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  if (dryRun) return { backups: [], changes: describe(), unchanged: false };
  const backup = await writeBackup(questRoot, targets);
  const staged = [];
  const committed = [];
  let createdLocaleDir = false;
  try {
    if (targets.some(target => !target.exists) && !(await safeLocaleTarget(questRoot, localeDir, targets.find(target => !target.exists).path)).exists) {
      try {
        await mkdir(localeDir, { recursive: false });
        createdLocaleDir = true;
        await safeExisting(questRoot, localeDir, "directory");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await safeExisting(questRoot, localeDir, "directory");
      }
    }
    for (const target of targets) staged.push({ target, temporary: await stage(target) });
    await beforeCommit();
    for (const target of targets) await verifyTargetUnchanged(questRoot, localeDir, target);
    for (const item of staged) {
      await renameFile(item.temporary, item.target.path);
      committed.push(item.target);
    }
  } catch (error) {
    for (const item of staged) await cleanupFile(item.temporary);
    const rollbackErrors = [];
    for (const target of committed.reverse()) {
      try { await restore(target); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (createdLocaleDir && rollbackErrors.length === 0) {
      try { await rmdir(localeDir); }
      catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") console.error("Quest save directory cleanup failed", cleanupError.code ?? "cleanup_failed");
      }
    }
    if (error.code === "REVISION_CONFLICT" && committed.length === 0 && rollbackErrors.length === 0) throw error;
    const failure = new Error(rollbackErrors.length ? "Save failed and rollback was incomplete" : "Save failed; committed files were restored");
    failure.cause = error;
    failure.rollbackIncomplete = rollbackErrors.length > 0;
    throw failure;
  }
  return { backups: [relative(questRoot, backup.folder).replaceAll("\\", "/")], backupManifest: backup.manifestFiles, changes: describe(), unchanged: false };
}

export function revisionHash(bytes) {
  return sha256(bytes);
}

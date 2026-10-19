#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPreviewConfig } from "./server/config.mjs";
import { prepareDemoQuestDir } from "./server/source.mjs";
import { QuestStore } from "./server/store.mjs";
import { schemaSnapshot } from "./server/schema.mjs";
import { saveQuestChanges } from "./server/save-service.mjs";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const fixtureQuestDir = join(appDir, "fixtures", "quests");

class CliError extends Error {
  constructor(code, message, details = {}, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

const HELP = `Usage: node cli.mjs <command> [options]

Commands:
  list                  List chapters and quests
  show <questId>        Show one quest (add --raw for the raw SNBT model)
  search <query>        Search quests (--in id,title,subtitle,description,tasks,rewards)
  lint                  Report quest-pack issues (--strict fails on errors)
  schema [section]      Print the FTB Quests data model and patch limits
  patch --file <path>   Validate/apply a JSON patch (dry-run by default)

Source options (same resolution as server.mjs):
  --data-dir <path>         Quest data directory containing chapters/
  --instance-root <path>    Minecraft instance root (for assets and default quests)
  --demo                    Use the editable local demo copy

Output options:
  --json                    Machine-readable JSON
  --locale <locale>         Locale for display and text writes (default en_us)
  --chapter <id>            Filter list output to one chapter

Patch options:
  --file <path>             Patch JSON file
  --apply                   Write changes; without it the command is a dry run
  --strict                  Exit 1 when lint reports errors

Examples:
  node cli.mjs list --json --brief
  node cli.mjs show demo_first --json
  node cli.mjs lint --json --strict
  node cli.mjs patch --file patch.json --json
  node cli.mjs patch --file patch.json --apply --json
`;

function splitList(value) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function parseArguments(argv) {
  const options = {
    json: false,
    brief: false,
    raw: false,
    strict: false,
    apply: false,
    dryRun: false,
    help: false,
    locale: null,
    chapter: null,
    file: null,
    in: null,
    sourceArgv: [],
  };
  const positionals = [];
  const takeValue = (name, index) => {
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new CliError("usage", `${name} requires a value`, {}, 2);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = true;
    else if (token === "--brief") options.brief = true;
    else if (token === "--raw") options.raw = true;
    else if (token === "--strict") options.strict = true;
    else if (token === "--apply") options.apply = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--demo") {
      options.sourceArgv.push("--demo");
    } else if (token === "--locale") {
      options.locale = takeValue(token, index);
      index += 1;
    } else if (token === "--chapter") {
      options.chapter = takeValue(token, index);
      index += 1;
    } else if (token === "--file") {
      options.file = takeValue(token, index);
      index += 1;
    } else if (token === "--in") {
      options.in = takeValue(token, index);
      index += 1;
    } else if (token === "--data-dir" || token === "--instance-root") {
      const value = takeValue(token, index);
      options.sourceArgv.push(token, value);
      index += 1;
    } else if (token.startsWith("--")) {
      throw new CliError("usage", `Unknown option: ${token}`, {}, 2);
    } else {
      positionals.push(token);
    }
  }
  if (options.apply && options.dryRun) throw new CliError("usage", "--apply and --dry-run cannot be combined", {}, 2);
  return { options, positionals };
}

async function openStore(options) {
  let previewConfig;
  try {
    previewConfig = await loadPreviewConfig({
      argv: options.sourceArgv,
      env: process.env,
      cwd: process.cwd(),
      projectDir: appDir,
      fixtureQuestDir,
    });
  } catch (error) {
    throw new CliError("source_error", error.message, {}, 1);
  }
  let questDir = previewConfig.questDir;
  if (previewConfig.isDemo) {
    try {
      questDir = await prepareDemoQuestDir({ appDir, fixtureQuestDir });
    } catch (error) {
      throw new CliError("source_error", error.message, {}, 1);
    }
  }
  try {
    const store = await QuestStore.load({ questDir, locale: options.locale ?? "en_us" });
    return { store, previewConfig };
  } catch (error) {
    throw new CliError("load_error", error.message, { questDir }, 1);
  }
}

function emit(options, value, human) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    human(value);
  }
}

function printList({ chapters, quests }) {
  for (const chapter of chapters) {
    process.stdout.write(`${chapter.id}  ${chapter.title}  (${chapter.questCount} quests)\n`);
  }
  if (chapters.length && quests.length) process.stdout.write("\n");
  for (const quest of quests) {
    const coords = quest.x === null || quest.y === null ? "no coords" : `(${quest.x}, ${quest.y})`;
    process.stdout.write(`${quest.id}  ${quest.title}  ${quest.chapterId}  ${coords}\n`);
  }
}

function printShow(quest) {
  process.stdout.write(`${quest.title}  (${quest.id})\n`);
  if (quest.subtitle) process.stdout.write(`subtitle: ${quest.subtitle}\n`);
  process.stdout.write(`chapter: ${quest.chapterId}  file: ${quest.file}${quest.line ? `:${quest.line}` : ""}\n`);
  process.stdout.write(`position: ${quest.x ?? "null"}, ${quest.y ?? "null"}  shape: ${quest.shape || "(default)"}  size: ${quest.size ?? "(default)"}\n`);
  if (quest.dependencies.length) process.stdout.write(`dependencies: ${quest.dependencies.join(", ")}\n`);
  process.stdout.write(`tasks: ${quest.tasks.length}  rewards: ${quest.rewards.length}\n`);
  if (quest.description.length) {
    process.stdout.write("description:\n");
    for (const line of quest.description) process.stdout.write(`  ${line}\n`);
  }
  if (quest.raw) process.stdout.write(`raw: ${JSON.stringify(quest.raw)}\n`);
}

function printSearch(matches) {
  for (const match of matches) {
    process.stdout.write(`${match.id}  ${match.title}  [${match.chapterId}]  ${match.matches.map(item => item.field).join(",")}\n`);
  }
}

function printLint({ issues, summary }) {
  for (const value of issues) {
    const location = value.file ? `  ${value.file}${value.questId ? `#${value.questId}` : ""}` : "";
    process.stdout.write(`${value.severity.toUpperCase()} ${value.code}  ${value.message}${location}\n`);
  }
  process.stdout.write(`summary: ${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} info\n`);
}

function printPatch(result) {
  if (result.unchanged) process.stdout.write("no changes (already up to date)\n");
  else process.stdout.write(result.dryRun ? "dry run: no files written\n" : "applied\n");
  for (const change of result.changes ?? []) {
    process.stdout.write(`${change.path}\n`);
    if (change.truncated) {
      process.stdout.write(`  diff truncated (${change.oldLines} -> ${change.newLines} lines)\n`);
      continue;
    }
    for (const hunk of change.hunks ?? []) {
      process.stdout.write(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`);
      for (const line of hunk.lines) process.stdout.write(`  ${line}\n`);
    }
  }
  for (const backup of result.backups ?? []) process.stdout.write(`backup: ${backup}\n`);
  if (result.issues?.length) printLint({ issues: result.issues, summary: result.lintSummary ?? { error: 0, warning: 0, info: 0 } });
}

function patchFields(change, index) {
  const allowed = new Set(["questId", "x", "y", "title", "subtitle", "description"]);
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    throw new CliError("invalid_patch", `edits[${index}] must be an object`, { path: `edits[${index}]` }, 1);
  }
  for (const key of Object.keys(change)) {
    if (!allowed.has(key)) {
      throw new CliError("invalid_patch", `edits[${index}] has unknown field '${key}'`, { path: `edits[${index}].${key}`, allowed: [...allowed] }, 1);
    }
  }
  if (typeof change.questId !== "string" || !change.questId) {
    throw new CliError("invalid_patch", `edits[${index}].questId must be a non-empty string`, { path: `edits[${index}].questId` }, 1);
  }
  const changed = Object.keys(change).filter(key => key !== "questId");
  if (!changed.length) {
    throw new CliError("invalid_patch", `edits[${index}] has no fields to change`, { path: `edits[${index}]` }, 1);
  }
  for (const key of changed) {
    const value = change[key];
    const path = `edits[${index}].${key}`;
    if (key === "x" || key === "y") {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 10_000 || Number(value.toFixed(6)) !== value) {
        throw new CliError("invalid_patch", `${path} must be a finite number in ±10000 with at most 6 decimals`, { path }, 1);
      }
    } else if (key === "title" || key === "subtitle") {
      if (typeof value !== "string" || value.length > 8_000) {
        throw new CliError("invalid_patch", `${path} must be a string of at most 8000 characters`, { path }, 1);
      }
    } else if (key === "description") {
      if (!Array.isArray(value) || value.length > 200 || value.some(line => typeof line !== "string" || line.length > 8_000)) {
        throw new CliError("invalid_patch", `${path} must be an array of at most 200 strings, each at most 8000 characters`, { path }, 1);
      }
    }
  }
  return change;
}

async function loadPatch(file) {
  const path = resolve(process.cwd(), file);
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError("patch_read_error", `Could not read patch file: ${error.message}`, { path }, 1);
  }
  let input;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new CliError("invalid_patch", `Patch file is not valid JSON: ${error.message}`, { path }, 1);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CliError("invalid_patch", "Patch file must contain a JSON object", { path }, 1);
  }
  const allowed = new Set(["locale", "edits", "changes"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new CliError("invalid_patch", `Patch has unknown field '${key}'`, { path: key, allowed: [...allowed] }, 1);
  }
  const edits = input.edits ?? input.changes;
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 100) {
    throw new CliError("invalid_patch", "Patch must contain edits: an array of 1-100 changes", { path: "edits" }, 1);
  }
  if (input.locale !== undefined && (typeof input.locale !== "string" || !/^[a-zA-Z0-9_-]{2,32}$/.test(input.locale))) {
    throw new CliError("invalid_patch", "Patch locale must match /^[a-zA-Z0-9_-]{2,32}$/", { path: "locale" }, 1);
  }
  return { locale: input.locale, edits: edits.map(patchFields) };
}

async function commandList(options) {
  const { store } = await openStore(options);
  if (options.chapter && !store.chapters.some(chapter => chapter.id === options.chapter)) {
    throw new CliError("chapter_not_found", `Chapter '${options.chapter}' was not found`, { chapterId: options.chapter }, 1);
  }
  const chapters = store.listChapters();
  const quests = store.listQuests({ chapterId: options.chapter ?? undefined });
  const base = {
    ok: true,
    command: "list",
    source: store.questDir,
    locale: store.locale,
    requestedLocale: store.requestedLocale,
    supportedLocales: store.locales,
    chapterGroups: store.chapterGroups.map(group => ({ id: group.id, title: group.title })),
    chapters,
  };
  if (options.brief) {
    base.quests = quests.map(quest => ({ id: quest.id, title: quest.title, chapterId: quest.chapterId, x: quest.x, y: quest.y }));
  } else {
    base.quests = quests;
  }
  emit(options, base, printList);
}

async function commandShow(options, positionals) {
  if (positionals.length !== 1) throw new CliError("usage", "show requires exactly one quest ID", {}, 2);
  const { store } = await openStore(options);
  const quest = store.showQuest(positionals[0], { raw: options.raw });
  if (!quest) throw new CliError("quest_not_found", `Quest '${positionals[0]}' was not found`, { questId: positionals[0] }, 1);
  emit(options, { ok: true, command: "show", locale: store.locale, quest }, printShow);
}

async function commandSearch(options, positionals) {
  if (positionals.length !== 1) throw new CliError("usage", "search requires exactly one query", {}, 2);
  const { store } = await openStore(options);
  const fields = options.in ? splitList(options.in) : undefined;
  let matches;
  try {
    matches = store.search(positionals[0], { fields });
  } catch (error) {
    throw new CliError("usage", error.message, {}, 2);
  }
  emit(options, { ok: true, command: "search", locale: store.locale, query: positionals[0], matches }, printSearch);
}

async function commandLint(options) {
  const { store } = await openStore(options);
  const result = store.lint();
  const strictFailed = Boolean(options.strict && result.strictFailed);
  emit(options, {
    ok: true,
    command: "lint",
    source: store.questDir,
    locale: store.locale,
    strict: Boolean(options.strict),
    strictFailed,
    ...result,
  }, printLint);
  if (strictFailed) process.exitCode = 1;
}

async function commandSchema(options, positionals) {
  if (positionals.length > 1) throw new CliError("usage", "schema accepts at most one section", {}, 2);
  const snapshot = schemaSnapshot();
  if (!positionals.length) {
    emit(options, { ok: true, command: "schema", schema: snapshot }, value => {
      process.stdout.write(`${JSON.stringify(value.schema, null, 2)}\n`);
    });
    return;
  }
  const section = positionals[0];
  const selected = snapshot.sections[section];
  if (!selected) {
    throw new CliError("unknown_schema_section", `Unknown schema section '${section}'`, { section, known: Object.keys(snapshot.sections) }, 1);
  }
  emit(options, { ok: true, command: "schema", section, schema: selected }, value => {
    process.stdout.write(`${JSON.stringify(value.schema, null, 2)}\n`);
  });
}

async function commandPatch(options) {
  if (!options.file) throw new CliError("usage", "patch requires --file <path>", {}, 2);
  const patch = await loadPatch(options.file);
  const localeHint = patch.locale ?? options.locale;
  const { store } = await openStore(localeHint ? { ...options, locale: localeHint } : options);
  const locale = patch.locale ?? options.locale ?? store.locale;
  if (!store.locales.includes(locale)) {
    throw new CliError("unsupported_locale", `Locale '${locale}' is not available; supported: ${store.locales.join(", ")}`, {
      locale,
      supportedLocales: store.locales,
    }, 1);
  }
  if (locale !== store.locale) {
    throw new CliError("unsupported_locale", `Store resolved locale '${store.locale}', but patch targets '${locale}'`, {
      locale,
      resolvedLocale: store.locale,
    }, 1);
  }
  const apply = Boolean(options.apply) && !options.dryRun;
  let saved;
  try {
    saved = await saveQuestChanges({
      questDir: store.questDir,
      chapterDir: join(store.questDir, "chapters"),
      localeDir: join(store.questDir, "lang"),
      locale,
      locales: store.locales,
      revisions: store.revisions,
      changes: patch.edits,
      dryRun: !apply,
    });
  } catch (error) {
    if (error.code === "REVISION_CONFLICT") {
      throw new CliError("conflict", `Quest data changed after it was read${error.relativePath ? `: ${error.relativePath}` : ""}; reload and retry`, {
        path: error.relativePath ?? null,
        expectedRevision: error.expectedRevision ?? null,
        actualRevision: error.actualRevision ?? null,
      }, 1);
    }
    throw new CliError("patch_failed", error.message, { rollbackIncomplete: Boolean(error.rollbackIncomplete) }, 1);
  }

  let issues = null;
  let lintSummary = null;
  if (apply && !saved.unchanged) {
    const reloaded = await QuestStore.load({ questDir: store.questDir, locale });
    const lint = reloaded.lint();
    issues = lint.issues;
    lintSummary = lint.summary;
  } else {
    const lint = store.lint();
    issues = lint.issues;
    lintSummary = lint.summary;
  }
  const strictFailed = Boolean(options.strict && (lintSummary?.error ?? 0) > 0);
  emit(options, {
    ok: true,
    command: "patch",
    dryRun: !apply,
    applied: apply && !saved.unchanged,
    unchanged: Boolean(saved.unchanged),
    locale,
    source: store.questDir,
    backups: saved.backups,
    changes: saved.changes,
    issues,
    lintSummary,
    strictFailed,
  }, printPatch);
  if (strictFailed) process.exitCode = 1;
}

async function main() {
  const wantsJson = process.argv.includes("--json");
  let options = { json: wantsJson };
  try {
    const parsed = parseArguments(process.argv.slice(2));
    options = parsed.options;
    const { positionals } = parsed;
    if (options.help || positionals.length === 0) {
      process.stdout.write(HELP);
      return;
    }
    const command = positionals.shift();
    if (command === "list") await commandList(options);
    else if (command === "show") await commandShow(options, positionals);
    else if (command === "search") await commandSearch(options, positionals);
    else if (command === "lint") await commandLint(options);
    else if (command === "schema") await commandSchema(options, positionals);
    else if (command === "patch") await commandPatch(options);
    else throw new CliError("usage", `Unknown command: ${command}`, { command }, 2);
  } catch (error) {
    const failure = error instanceof CliError
      ? error
      : new CliError("internal_error", error.stack ?? error.message ?? String(error), {}, 1);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message, ...failure.details } }, null, 2)}\n`);
    } else {
      process.stderr.write(`error: ${failure.message}\n`);
    }
    process.exitCode = failure.exitCode ?? 1;
  }
}

await main();

#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSnbt } from "./parse-snbt.mjs";
import { loadPreviewConfig } from "./server/config.mjs";
import { readChapterGroups } from "./server/chapter-groups.mjs";
import { revisionHash, saveQuestChanges } from "./server/save-service.mjs";
import { prepareDemoQuestDir } from "./server/source.mjs";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rawArgs = process.argv.slice(2);
const openOnStart = rawArgs.includes("--open") && !rawArgs.includes("--no-open");
const args = rawArgs.filter(arg => arg !== "--open" && arg !== "--no-open");
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: ftbquest [--demo | --instance-root PATH | --data-dir PATH | --config PATH] [--open]");
  console.log("       ftbquest-preview [--demo | --instance-root PATH | --data-dir PATH | --config PATH] [--no-open]");
  console.log("       QUEST_PREVIEW_INSTANCE_ROOT, QUEST_PREVIEW_DATA_DIR, and quest-preview.local.json are also supported.");
  process.exit(0);
}
const fixtureQuestDir = join(appDir, "fixtures", "quests");
const previewConfig = await loadPreviewConfig({ argv: args, env: process.env, cwd: process.cwd(), projectDir: appDir, fixtureQuestDir });
const root = previewConfig.instanceRoot ?? appDir;
let QUEST_DIR = previewConfig.questDir;
if (previewConfig.isDemo) {
  QUEST_DIR = await prepareDemoQuestDir({ appDir, fixtureQuestDir });
}
const CHAPTER_DIR = QUEST_DIR ? join(QUEST_DIR, "chapters") : null;
const LOCALE_DIR = QUEST_DIR ? join(QUEST_DIR, "lang") : null;
const MOD_DIR = join(root, "mods");
const RESOURCEPACK_DIR = join(root, "resourcepacks");
const ASSET_DIRS = [join(root, "assets"), resolve(root, "../assets"), resolve(root, "../../../assets")];
const HOST = "127.0.0.1";
const PORT = Number(process.env.QUEST_PREVIEW_PORT || 4173);
const WRITE_TOKEN = randomBytes(32).toString("hex");

const archiveCache = new Map();
const localeCache = new Map();
const clients = new Set();
let unifontCache;
let localArchives;
let resourcepackArchives;
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function openLocalBrowser(url) {
  const [command, commandArgs] = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(command, commandArgs, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening a browser is best-effort; the URL is still printed.
  }
}

async function assertSetupDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`${label}不存在：${path}`);
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`${label}不是目录：${path}`);
}

async function assertSetupQuestDirectory(path) {
  await assertSetupDirectory(path, "quests 数据目录");
  await assertSetupDirectory(join(path, "chapters"), "chapters 目录");
  try {
    const lang = await stat(join(path, "lang"));
    if (!lang.isDirectory()) throw new Error(`lang 不是目录：${join(path, "lang")}`);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
}

function setupPath(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return resolve(process.cwd(), value.trim());
}

async function buildSetupConfig(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是对象");
  const allowed = new Set(["mode", "instanceRoot", "dataDir"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new Error(`未知字段：${key}`);
  if (body.mode === "demo") return { version: 1, mode: "demo" };
  if (body.mode === "instance") {
    const instanceRoot = setupPath(body.instanceRoot, "实例目录");
    await assertSetupDirectory(instanceRoot, "Minecraft 实例目录");
    const questDir = join(instanceRoot, "config", "ftbquests", "quests");
    await assertSetupQuestDirectory(questDir);
    return { version: 1, mode: "instance", instanceRoot };
  }
  if (body.mode === "data") {
    const dataDir = setupPath(body.dataDir, "quests 数据目录");
    await assertSetupQuestDirectory(dataDir);
    const config = { version: 1, mode: "instance", dataDir };
    if (body.instanceRoot !== undefined) {
      if (typeof body.instanceRoot !== "string" || body.instanceRoot.trim().length === 0) {
        throw new Error("实例目录必须是字符串");
      }
      const instanceRoot = setupPath(body.instanceRoot, "实例目录");
      await assertSetupDirectory(instanceRoot, "Minecraft 实例目录");
      config.instanceRoot = instanceRoot;
    }
    return config;
  }
  throw new Error("mode 必须是 instance、data 或 demo");
}

async function writeSetupConfig(config) {
  const configPath = previewConfig.configPath;
  if (!configPath) throw new Error("没有可写的配置文件路径");
  await mkdir(dirname(configPath), { recursive: true });
  try {
    await copyFile(configPath, `${configPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, configPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return configPath;
}

function zipEntries(buffer) {
  let eocd = -1;
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end directory not found");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP central directory");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength).replaceAll("\\", "/");
    entries.set(name, { method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function archive(file) {
  if (!archiveCache.has(file)) {
    const promise = readFile(file).then(buffer => ({ buffer, entries: zipEntries(buffer) }));
    archiveCache.set(file, promise);
  }
  return archiveCache.get(file);
}

async function zipRead(file, entryName) {
  let pack;
  try {
    pack = await archive(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const entry = pack.entries.get(entryName);
  if (!entry) return null;
  const start = entry.localOffset;
  if (pack.buffer.readUInt32LE(start) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${entryName}`);
  const nameLength = pack.buffer.readUInt16LE(start + 26);
  const extraLength = pack.buffer.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLength + extraLength;
  const data = pack.buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entryName}`);
}

async function availableLocales() {
  const files = await optionalFiles(LOCALE_DIR, name => name.endsWith(".snbt"));
  return files.map(file => basename(file, ".snbt"))
    .filter(locale => /^[a-zA-Z0-9_-]{2,32}$/.test(locale)).sort();
}

async function loadLocale(locale) {
  if (!localeCache.has(locale)) {
    localeCache.set(locale, readFile(join(LOCALE_DIR, `${locale}.snbt`), "utf8")
      .then(source => parseSnbt(source, `lang/${locale}.snbt`))
      .catch(error => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return Object.create(null);
        throw error;
      }));
  }
  return { locale, strings: await localeCache.get(locale) };
}

async function optionalFiles(directory, predicate = () => true) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && predicate(entry.name))
      .map(entry => join(directory, entry.name));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}

async function optionalDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}

async function containedPath(base, candidate, type = "file") {
  try {
    const basePath = await realpath(base);
    const targetPath = await realpath(candidate);
    const targetRelative = relative(basePath, targetPath);
    if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) return null;
    const details = await stat(targetPath);
    if (type === "file" && !details.isFile()) return null;
    if (type === "directory" && !details.isDirectory()) return null;
    return targetPath;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

async function activeResourcepacks() {
  if (resourcepackArchives) return resourcepackArchives;
  const resourcepackDir = await containedPath(root, RESOURCEPACK_DIR, "directory");
  if (!resourcepackDir) return [];
  const available = await optionalFiles(resourcepackDir, name => name.toLowerCase().endsWith(".zip"));
  let selected = [];
  let hasPackList = false;
  try {
    const optionsFile = await containedPath(root, join(root, "options.txt"));
    const options = optionsFile ? await readFile(optionsFile, "utf8") : "";
    const match = options.match(/(?:^|\n)resourcePacks:(\[[^\r\n]*\])/);
    if (match) {
      hasPackList = true;
      const names = JSON.parse(match[1]).filter(name => typeof name === "string" && name.startsWith("file/"));
      selected = names.map(name => name.slice(5))
        .filter(name => name && basename(name) === name && name.toLowerCase().endsWith(".zip"))
        .map(name => join(resourcepackDir, name));
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const seen = new Set();
  const candidates = hasPackList ? selected : available;
  const validated = [];
  for (const file of candidates) {
    const safeFile = await containedPath(resourcepackDir, file);
    if (safeFile) validated.push(safeFile);
  }
  resourcepackArchives = validated.filter(file => {
    const key = file.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return resourcepackArchives;
}

async function localArchiveFiles() {
  if (localArchives) return localArchives;
  const parents = [root, resolve(root, ".."), resolve(root, "../.."), resolve(root, "../../..")];
  const instanceVersionHint = basename(resolve(root, "..")).match(/^(\d+\.\d+(?:\.\d+)?)/)?.[1];
  const versionJars = [];
  for (const parent of parents) {
    const versionsRoot = await containedPath(parent, join(parent, "versions"), "directory");
    if (!versionsRoot) continue;
    const versionDirs = await optionalDirectories(versionsRoot);
    const versionHint = instanceVersionHint ?? basename(parent).match(/^(\d+\.\d+(?:\.\d+)?)/)?.[1];
    const matchingVersion = versionHint && versionDirs.includes(versionHint) ? [versionHint] : [];
    const singleJarVersion = versionDirs.length === 1 ? versionDirs : [];
    for (const versionDir of matchingVersion.length ? matchingVersion : singleJarVersion) {
      const jar = await containedPath(versionsRoot, join(versionsRoot, versionDir, `${versionDir}.jar`));
      if (jar) versionJars.push(jar);
    }
  }
  const modDir = await containedPath(root, MOD_DIR, "directory");
  const mods = modDir ? await optionalFiles(modDir, name => /^ftb-(?:quests|library)-.*\.jar$/i.test(name)) : [];
  localArchives = [...versionJars, ...mods];
  return localArchives;
}

async function questData(locale) {
  if (!QUEST_DIR) throw Object.assign(new Error("Quest data source is not configured"), { statusCode: 503 });
  let defaults = {};
  try {
    defaults = parseSnbt(await readFile(join(QUEST_DIR, "data.snbt"), "utf8"), "data.snbt");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const files = (await readdir(CHAPTER_DIR)).filter(name => name.endsWith(".snbt")).sort();
  const chapters = await Promise.all(files.map(async file => {
    const bytes = await readFile(join(CHAPTER_DIR, file));
    const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { file, bytes, data: parseSnbt(source, `chapters/${file}`) };
  }));
  const discoveredLocales = await availableLocales();
  const supportedLocales = discoveredLocales.length ? discoveredLocales : ["en_us"];
  const defaultLocale = supportedLocales.includes("en_us") ? "en_us" : supportedLocales[0];
  const usedLocale = supportedLocales.includes(locale) ? locale : defaultLocale;
  const localePath = join(LOCALE_DIR, `${usedLocale}.snbt`);
  let localeBytes = null;
  try { localeBytes = await readFile(localePath); }
  catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
  const strings = localeBytes === null
    ? Object.create(null)
    : parseSnbt(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localeBytes), `lang/${usedLocale}.snbt`);
  localeCache.set(usedLocale, Promise.resolve(strings));
  const { strings: fallback } = usedLocale === "en_us" ? { strings } : await loadLocale("en_us");
  const chapterGroups = await readChapterGroups({ questDir: QUEST_DIR, localeStrings: strings, fallbackStrings: fallback });
  const revisions = Object.fromEntries(chapters.map(({ file, bytes }) => [`chapters/${file}`, revisionHash(bytes)]));
  revisions[`lang/${usedLocale}.snbt`] = localeBytes === null ? null : revisionHash(localeBytes);
  return {
    locale: usedLocale,
    editing: { enabled: true, token: WRITE_TOKEN, revisions },
    defaultQuestShape: defaults.default_quest_shape ?? null,
    gridScale: defaults.grid_scale ?? null,
    supportedLocales,
    chapterGroups,
    chapters: chapters.map(({ file, data }) => ({
      id: data.id,
      file,
      title: strings[`chapter.${data.id}.title`] ?? fallback[`chapter.${data.id}.title`] ?? data.title ?? data.id,
      icon: data.icon?.id ?? "",
      order: data.order ?? data.sort_order ?? null,
      group: data.group ?? null,
      defaultQuestShape: data.default_quest_shape ?? null,
      defaultQuestSize: data.default_quest_size ?? null,
      images: data.images ?? [],
      defaultHideDependencyLines: data.default_hide_dependency_lines ?? null,
      quests: (data.quests ?? []).map(quest => ({
        id: quest.id,
        title: strings[`quest.${quest.id}.title`] ?? fallback[`quest.${quest.id}.title`] ?? quest.title ?? quest.id,
        subtitle: strings[`quest.${quest.id}.quest_subtitle`] ?? fallback[`quest.${quest.id}.quest_subtitle`] ?? quest.subtitle ?? "",
        description: strings[`quest.${quest.id}.quest_desc`] ?? fallback[`quest.${quest.id}.quest_desc`] ?? quest.quest_desc ?? [],
        icon: quest.icon?.id ?? "",
        x: quest.x ?? null,
        y: quest.y ?? null,
        width: quest.width ?? null,
        height: quest.height ?? null,
        size: quest.size ?? null,
        shape: quest.shape ?? null,
        dependencies: quest.dependencies ?? [],
        tasks: quest.tasks ?? [],
        rewards: quest.rewards ?? [],
        minWidth: quest.min_width ?? 0,
      })),
    })),
    files: {
      chapters: relativeToRoot(CHAPTER_DIR),
      locale: relativeToRoot(join(LOCALE_DIR, `${usedLocale}.snbt`)),
    },
  };
}

function relativeToRoot(path) {
  const absolute = resolve(path);
  const rootRelative = relative(root, absolute);
  const isOutsideRoot = isAbsolute(rootRelative) || rootRelative === ".." || rootRelative.startsWith(`..${sep}`);
  const displayPath = isOutsideRoot ? join("external-quest-data", relative(QUEST_DIR, absolute)) : rootRelative;
  return displayPath.replaceAll("\\", "/");
}

async function resource(location) {
  const match = /^([a-z0-9_.-]+):(.+)$/i.exec(location);
  if (!match) return null;
  const [, namespace, rawPath] = match;
  const resourcePath = normalize(rawPath).replaceAll("\\", "/");
  if (resourcePath.startsWith("../") || resourcePath === ".." || resourcePath.startsWith("/")) return null;
  const candidates = [resourcePath];
  if (!resourcePath.startsWith("textures/") && !resourcePath.startsWith("font/")) {
    candidates.push(`textures/${resourcePath}`);
  } else if (resourcePath.startsWith("font/")) {
    candidates.push(`textures/${resourcePath}`);
  }
  for (const candidate of candidates) {
    const directPath = `assets/${namespace}/${candidate}`;
    const kubeRoot = await containedPath(root, join(root, "kubejs", "assets"), "directory");
    if (kubeRoot) {
      const kubePath = await containedPath(kubeRoot, join(kubeRoot, namespace, candidate));
      if (kubePath) return await readFile(kubePath);
    }
    for (const jarPath of [...await localArchiveFiles(), ...await activeResourcepacks()]) {
      const asset = await zipRead(jarPath, directPath);
      if (asset) return asset;
    }
  }
  return null;
}

async function unifontGlyphs(codepoints) {
  if (!unifontCache) {
    unifontCache = (async () => {
      const assetRoots = [];
      for (const directory of ASSET_DIRS) {
        const assetRoot = await containedPath(dirname(directory), directory, "directory");
        if (assetRoot) assetRoots.push(assetRoot);
      }
      const indexes = [];
      for (const assetRoot of assetRoots) {
        for (const indexFile of await optionalFiles(join(assetRoot, "indexes"), name => name.endsWith(".json"))) {
          const safeIndex = await containedPath(assetRoot, indexFile);
          if (safeIndex) indexes.push({ file: safeIndex, root: assetRoot });
        }
      }
      indexes.sort((left, right) => right.file.localeCompare(left.file));
      let object;
      let assetRoot;
      for (const indexFile of indexes) {
        const index = JSON.parse(await readFile(indexFile.file, "utf8"));
        object = index.objects?.["minecraft/font/unifont.zip"];
        if (object) {
          assetRoot = indexFile.root;
          break;
        }
      }
      if (!/^[a-f0-9]{40}$/i.test(object?.hash ?? "")) return new Map();
      const assetFile = await containedPath(assetRoot, join(assetRoot, "objects", object.hash.slice(0, 2), object.hash));
      if (!assetFile) return new Map();
      const pack = await archive(assetFile);
      const hexName = [...pack.entries.keys()].find(name => name.endsWith(".hex"));
      if (!hexName) throw new Error("Unifont ZIP has no .hex data file");
      const bytes = await zipRead(assetFile, hexName);
      const records = new Map();
      for (const line of bytes.toString("ascii").split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator < 1) continue;
        const codepoint = Number.parseInt(line.slice(0, separator), 16);
        const bitmap = line.slice(separator + 1);
        if (Number.isInteger(codepoint) && bitmap.length === 64) records.set(codepoint, bitmap);
      }
      return records;
    })();
  }
  const records = await unifontCache;
  const result = {};
  for (const codepoint of codepoints) {
    const bitmap = records.get(codepoint);
    if (!bitmap) continue;
    const code = codepoint.toString(16).toUpperCase().padStart(4, "0");
    let left = 16;
    let right = -1;
    for (let row = 0; row < 16; row += 1) {
      const bits = Number.parseInt(bitmap.slice(row * 4, row * 4 + 4), 16);
      for (let column = 0; column < 16; column += 1) {
        if ((bits & (1 << (15 - column))) !== 0) {
          left = Math.min(left, column);
          right = Math.max(right, column);
        }
      }
    }
    const hasWideOverride = [
      [0x3001, 0x30ff], [0x3200, 0x9fff], [0x1100, 0x11ff], [0x3130, 0x318f],
      [0xa960, 0xa97f], [0xd7b0, 0xd7ff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xff01, 0xff5e],
    ].some(([from, to]) => codepoint >= from && codepoint <= to);
    const glyphWidth = hasWideOverride ? 16 : right < left ? 0 : right - left + 1;
    const advance = hasWideOverride ? 9 : Math.floor(glyphWidth / 2) + 1;
    result[code] = { bitmap, advance, height: 16 };
  }
  return result;
}

async function serveAsset(url, response) {
  const location = url.searchParams.get("location") ?? "";
  const normalized = location.replaceAll("\\", "/");
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\.png)?$/i.test(normalized) || normalized.includes("..")) {
    response.writeHead(400).end("Invalid asset location");
    return;
  }
  const source = normalized.endsWith(".png") ? normalized : `${normalized}.png`;
  let image = await resource(source);
  if (!image) {
    const raw = /^([^:]+):(.+)$/.exec(normalized);
    const candidates = raw ? [
      `${raw[1]}:textures/item/${raw[2]}.png`,
      `${raw[1]}:textures/block/${raw[2]}.png`,
    ] : [];
    for (const candidate of candidates) {
      image = await resource(candidate);
      if (image) break;
    }
  }
  if (!image) {
    response.writeHead(404).end("Asset not found in the current local pack");
    return;
  }
  response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(image);
}

function json(response, value) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function jsonStatus(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function requestJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw Object.assign(new Error("Invalid content type"), { statusCode: 415 });
  const length = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > 512_000) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 512_000) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  }
}

function validWriteOrigin(request) {
  const port = server.address()?.port ?? PORT;
  return request.headers.host === `${HOST}:${port}`
    && request.headers.origin === `http://${HOST}:${port}`;
}

function validWriteToken(request) {
  const supplied = request.headers["x-quest-preview-token"];
  if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(WRITE_TOKEN));
}

let saveInProgress = false;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const activePort = server.address()?.port ?? PORT;
  if (request.headers.host !== `${HOST}:${activePort}`) {
    jsonStatus(response, 403, { error: "host_rejected" });
    return;
  }
  try {
    if (url.pathname === "/api/setup") {
      if (request.method === "GET") {
        json(response, {
          ok: true,
          needsSetup: Boolean(previewConfig.needsSetup),
          configPath: previewConfig.configPath,
          configExists: Boolean(previewConfig.configExists),
          current: {
            source: previewConfig.source,
            isDemo: Boolean(previewConfig.isDemo),
          },
        });
        return;
      }
      if (request.method !== "POST") {
        jsonStatus(response, 405, { error: "method_not_allowed" });
        return;
      }
      if (!validWriteOrigin(request)) {
        jsonStatus(response, 403, { error: "origin_rejected" });
        return;
      }
      let config;
      try {
        const body = await requestJson(request);
        config = await buildSetupConfig(body);
      } catch (error) {
        if (error.statusCode) {
          jsonStatus(response, error.statusCode, { error: error.statusCode === 413 ? "request_too_large" : "invalid_request" });
        } else {
          jsonStatus(response, 400, { error: "setup_invalid", message: error.message });
        }
        return;
      }
      let configPath;
      try {
        configPath = await writeSetupConfig(config);
      } catch (error) {
        console.error("Quest setup write failed", error);
        jsonStatus(response, 500, { error: "setup_write_failed", message: error.message });
        return;
      }
      jsonStatus(response, 200, { ok: true, restart: true, configPath });
      process.send?.({ type: "setup-restart", configPath });
      setTimeout(() => process.exit(75), 150);
      return;
    }
    if (url.pathname === "/api/data") {
      if (request.method !== "GET") {
        jsonStatus(response, 405, { error: "method_not_allowed" });
        return;
      }
      if (previewConfig.needsSetup || !QUEST_DIR) {
        jsonStatus(response, 503, { error: "setup_required" });
        return;
      }
      json(response, await questData(url.searchParams.get("locale") ?? "en_us"));
      return;
    }
    if (url.pathname === "/api/save") {
      if (previewConfig.needsSetup || !QUEST_DIR) {
        jsonStatus(response, 503, { error: "setup_required" });
        return;
      }
      if (request.method !== "POST") {
        jsonStatus(response, 405, { error: "method_not_allowed" });
        return;
      }
      if (!validWriteOrigin(request)) {
        jsonStatus(response, 403, { error: "origin_rejected" });
        return;
      }
      if (!validWriteToken(request)) {
        jsonStatus(response, 403, { error: "token_rejected" });
        return;
      }
      if (saveInProgress) {
        jsonStatus(response, 409, { error: "save_in_progress" });
        return;
      }
      saveInProgress = true;
      try {
        const body = await requestJson(request);
        if (Object.keys(body).some(key => !["locale", "revisions", "changes"].includes(key))) throw new TypeError("Unexpected request field");
        const locales = await availableLocales();
        const saveLocales = locales.length ? locales : ["en_us"];
        const result = await saveQuestChanges({
          questDir: QUEST_DIR,
          chapterDir: CHAPTER_DIR,
          localeDir: LOCALE_DIR,
          locale: body.locale,
          locales: saveLocales,
          revisions: body.revisions,
          changes: body.changes,
        });
        localeCache.clear();
        archiveCache.clear();
        const data = await questData(body.locale);
        jsonStatus(response, 200, { saved: true, backups: result.backups, data });
      } catch (error) {
        if (error.code === "REVISION_CONFLICT") jsonStatus(response, 409, { error: "conflict" });
        else if (error.statusCode) jsonStatus(response, error.statusCode, { error: error.statusCode === 413 ? "request_too_large" : error.statusCode === 415 ? "json_required" : "invalid_request" });
        else if (error instanceof TypeError) jsonStatus(response, 400, { error: "invalid_request" });
        else {
          console.error("Quest save failed", error.rollbackIncomplete ? "rollback incomplete" : "rollback attempted");
          jsonStatus(response, 500, { error: "save_failed" });
        }
      } finally {
        saveInProgress = false;
      }
      return;
    }
    if (url.pathname === "/api/asset") {
      await serveAsset(url, response);
      return;
    }
    if (url.pathname === "/api/font") {
      const text = url.searchParams.get("text") ?? "";
      const codepoints = [...new Set(Array.from(text, character => character.codePointAt(0)))].filter(codepoint => codepoint > 0x7f);
      json(response, { glyphs: await unifontGlyphs(codepoints) });
      return;
    }
    if (url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write("event: ready\ndata: {}\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    let route;
    try {
      route = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end("Invalid path");
      return;
    }
    if (route === "/") route = previewConfig.needsSetup ? "/setup.html" : "/index.html";
    const allowed = ["/index.html", "/setup.html", "/setup.js", "/app.js", "/styles.css"].includes(route)
      || /^\/(?:components|lib)\/[a-zA-Z0-9_-]+\.js$/.test(route)
      || /^\/styles\/[a-zA-Z0-9_-]+\.css$/.test(route);
    if (!allowed) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = resolve(appDir, `.${route}`);
    const relativeFile = relative(appDir, file);
    if (isAbsolute(relativeFile) || relativeFile === ".." || relativeFile.startsWith(`..${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const resolvedFile = await realpath(file);
    const resolvedRelative = relative(appDir, resolvedFile);
    if (isAbsolute(resolvedRelative) || resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!(await stat(resolvedFile)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(resolvedFile);
    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error(error.stack ?? error);
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Internal server error" }));
  }
});

process.on("disconnect", () => {
  for (const client of clients) client.end();
  if (!server.listening) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
});

const previewUrl = `http://${HOST}:${PORT}`;
server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set QUEST_PREVIEW_PORT to another port, or close the known Quest Preview using it.`);
    process.exit(1);
  }
  throw error;
});
server.listen(PORT, HOST, () => {
  console.log(`Quest preview ready at ${previewUrl}`);
  if (previewConfig.needsSetup) {
    console.log("No quest data source configured yet; open the browser setup page.");
  } else {
    console.log(`Quest data loaded (${previewConfig.isDemo ? "editable local demo copy" : "selected data directory"}).`);
  }
  console.log("Instance assets are optional; missing fonts and textures use browser fallbacks.");
  if (openOnStart) openLocalBrowser(previewUrl);
});

const notifyReload = () => {
  for (const client of clients) client.write("event: reload\ndata: {}\n\n");
  localeCache.clear();
  archiveCache.clear();
  console.log("Quest data changed; browser preview refreshed");
};
if (QUEST_DIR) {
  for (const folder of [QUEST_DIR, CHAPTER_DIR, LOCALE_DIR]) {
    try {
      watch(folder, { persistent: true }, notifyReload);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

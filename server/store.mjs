import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseSnbt } from "../parse-snbt.mjs";
import { revisionHash } from "./save-service.mjs";
import { QUEST_SHAPES } from "./schema.mjs";
import { lintStore } from "./lint.mjs";

const DEFAULT_LOCALE = "en_us";
const LOCALE_PATTERN = /^[a-zA-Z0-9_-]{2,32}$/;

function decodeUtf8(bytes, label) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

async function readLocaleDirectory(localeDir) {
  let entries;
  try {
    entries = await readdir(localeDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".snbt"))
    .map(entry => basename(entry.name, ".snbt"))
    .filter(locale => LOCALE_PATTERN.test(locale))
    .sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDescription(value) {
  if (Array.isArray(value)) return value.map(line => String(line ?? ""));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function localized(strings, fallback, key) {
  return strings[key] ?? fallback[key];
}

function questLine(source, questId) {
  if (!source) return null;
  const index = source.indexOf(questId);
  if (index < 0) return null;
  return source.slice(0, index).split("\n").length;
}

export class QuestStore {
  constructor({ questDir, locale, requestedLocale, locales, strings, fallbackStrings, translatedTitleIds, defaults, chapters, chapterGroups, revisions, dataPresent, chapterGroupsPresent }) {
    this.questDir = questDir;
    this.locale = locale;
    this.requestedLocale = requestedLocale;
    this.locales = locales;
    this.strings = strings;
    this.fallbackStrings = fallbackStrings;
    this.translatedTitleIds = translatedTitleIds;
    this.defaults = defaults;
    this.chapters = chapters;
    this.chapterGroups = chapterGroups;
    this.revisions = revisions;
    this.dataPresent = dataPresent;
    this.chapterGroupsPresent = chapterGroupsPresent;
    this.questsById = new Map();
    this.duplicateQuestIds = new Map();
    this.duplicateObjectIds = new Map();
    for (const chapter of chapters) {
      for (const quest of chapter.quests) {
        if (quest.id) {
          if (!this.questsById.has(quest.id)) this.questsById.set(quest.id, quest);
          else {
            if (!this.duplicateQuestIds.has(quest.id)) this.duplicateQuestIds.set(quest.id, []);
            this.duplicateQuestIds.get(quest.id).push(quest);
          }
        }
        const objects = [
          ...asArray(quest.raw.tasks).map(value => ({ value, kind: "task" })),
          ...asArray(quest.raw.rewards).map(value => ({ value, kind: "reward" })),
        ];
        for (const { value: object, kind } of objects) {
          if (!object || typeof object !== "object" || typeof object.id !== "string" || !object.id) continue;
          if (!this.duplicateObjectIds.has(object.id)) this.duplicateObjectIds.set(object.id, []);
          this.duplicateObjectIds.get(object.id).push({ questId: quest.id, kind });
        }
      }
    }
  }

  static async load({ questDir, locale = DEFAULT_LOCALE }) {
    const chapterDir = join(questDir, "chapters");
    const localeDir = join(questDir, "lang");
    const dataBytes = await readOptional(join(questDir, "data.snbt"));
    const groupsBytes = await readOptional(join(questDir, "chapter_groups.snbt"));
    const defaults = dataBytes ? parseSnbt(decodeUtf8(dataBytes, "data.snbt"), "data.snbt") : {};
    const discoveredLocales = await readLocaleDirectory(localeDir);
    const locales = discoveredLocales.length ? discoveredLocales : [DEFAULT_LOCALE];
    const defaultLocale = locales.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : locales[0];
    const requestedLocale = locale || defaultLocale;
    const usedLocale = locales.includes(requestedLocale) ? requestedLocale : defaultLocale;

    const strings = await loadLocaleStrings(localeDir, usedLocale);
    const fallbackStrings = usedLocale === DEFAULT_LOCALE ? strings : await loadLocaleStrings(localeDir, DEFAULT_LOCALE);
    const translatedTitleIds = new Set();
    for (const availableLocale of locales) {
      const table = availableLocale === usedLocale ? strings : availableLocale === DEFAULT_LOCALE ? fallbackStrings : await loadLocaleStrings(localeDir, availableLocale);
      for (const key of Object.keys(table)) {
        const match = /^quest\.(.+)\.title$/.exec(key);
        if (match) translatedTitleIds.add(match[1]);
      }
    }

    let chapterFiles;
    try {
      chapterFiles = (await readdir(chapterDir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith(".snbt"))
        .map(entry => entry.name)
        .sort();
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Quest chapters directory does not exist: ${chapterDir}`);
      throw error;
    }

    const revisions = {};
    const chapters = [];
    for (const file of chapterFiles) {
      const path = join(chapterDir, file);
      let bytes;
      try {
        bytes = await readFile(path);
      } catch (error) {
        throw new Error(`Could not read chapters/${file}: ${error.message}`);
      }
      revisions[`chapters/${file}`] = revisionHash(bytes);
      const source = decodeUtf8(bytes, `chapters/${file}`);
      const raw = parseSnbt(source, `chapters/${file}`);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`chapters/${file} must contain a compound`);
      const id = typeof raw.id === "string" ? raw.id : basename(file, ".snbt");
      const chapterTitle = localized(strings, fallbackStrings, `chapter.${id}.title`) ?? raw.title ?? id;
      const chapterSubtitle = localized(strings, fallbackStrings, `chapter.${id}.chapter_subtitle`) ?? raw.subtitle ?? "";
      const quests = asArray(raw.quests).map(questRaw => buildQuest({
        questRaw, chapterId: id, chapterFile: file, source, strings, fallbackStrings,
      }));
      chapters.push({
        id,
        file,
        filename: typeof raw.filename === "string" ? raw.filename : null,
        group: typeof raw.group === "string" ? raw.group : "",
        title: String(chapterTitle),
        subtitle: String(chapterSubtitle),
        defaultQuestShape: raw.default_quest_shape ?? defaults.default_quest_shape ?? null,
        defaultQuestSize: raw.default_quest_size ?? defaults.default_quest_size ?? null,
        images: asArray(raw.images),
        questLinks: asArray(raw.quest_links),
        quests,
        raw,
        source,
      });
    }

    let chapterGroups = [];
    if (groupsBytes) {
      const groupsRaw = parseSnbt(decodeUtf8(groupsBytes, "chapter_groups.snbt"), "chapter_groups.snbt");
      const list = Array.isArray(groupsRaw) ? groupsRaw : asArray(groupsRaw?.chapter_groups);
      chapterGroups = list
        .filter(group => group && typeof group === "object" && typeof group.id === "string")
        .map(group => ({
          id: group.id,
          title: String(localized(strings, fallbackStrings, `chapter_group.${group.id}.title`) ?? group.title ?? group.id),
          raw: group,
        }));
    }

    const localePath = join(localeDir, `${usedLocale}.snbt`);
    const localeBytes = await readOptional(localePath);
    revisions[`lang/${usedLocale}.snbt`] = localeBytes === null ? null : revisionHash(localeBytes);

    return new QuestStore({
      questDir,
      locale: usedLocale,
      requestedLocale,
      locales,
      strings,
      fallbackStrings,
      translatedTitleIds,
      defaults,
      chapters,
      chapterGroups,
      revisions,
      dataPresent: dataBytes !== null,
      chapterGroupsPresent: groupsBytes !== null,
    });
  }

  listChapters() {
    return this.chapters.map(chapter => ({
      id: chapter.id,
      title: chapter.title,
      subtitle: chapter.subtitle,
      file: chapter.file,
      group: chapter.group,
      groupTitle: this.chapterGroups.find(group => group.id === chapter.group)?.title ?? "",
      questCount: chapter.quests.length,
      linkCount: chapter.questLinks.length,
      imageCount: chapter.images.length,
    }));
  }

  listQuests({ chapterId } = {}) {
    const quests = chapterId
      ? this.chapters.filter(chapter => chapter.id === chapterId).flatMap(chapter => chapter.quests)
      : this.chapters.flatMap(chapter => chapter.quests);
    return quests.map(quest => ({
      id: quest.id,
      title: quest.title,
      subtitle: quest.subtitle,
      chapterId: quest.chapterId,
      chapterTitle: this.chapters.find(chapter => chapter.id === quest.chapterId)?.title ?? quest.chapterId,
      file: `chapters/${quest.chapterFile}`,
      x: quest.x,
      y: quest.y,
      shape: quest.shape,
      dependencyCount: quest.dependencies.length,
      taskCount: quest.tasks.length,
      rewardCount: quest.rewards.length,
    }));
  }

  getQuest(questId) {
    return this.questsById.get(questId) ?? null;
  }

  showQuest(questId, { raw = false } = {}) {
    const quest = this.getQuest(questId);
    if (!quest) return null;
    const chapter = this.chapters.find(item => item.id === quest.chapterId);
    const value = {
      id: quest.id,
      chapterId: quest.chapterId,
      chapterTitle: chapter?.title ?? quest.chapterId,
      chapterGroup: chapter?.group ?? "",
      chapterGroupTitle: this.chapterGroups.find(group => group.id === chapter?.group)?.title ?? "",
      file: `chapters/${quest.chapterFile}`,
      line: quest.line,
      title: quest.title,
      subtitle: quest.subtitle,
      description: quest.description,
      x: quest.x,
      y: quest.y,
      shape: quest.shape,
      size: quest.size,
      icon: quest.icon,
      minWidth: quest.minWidth,
      dependencies: quest.dependencies,
      tasks: quest.tasks,
      rewards: quest.rewards,
      titleSource: quest.titleSource,
    };
    if (raw) value.raw = quest.raw;
    return value;
  }

  search(query, { fields = ["id", "title", "subtitle", "description", "tasks", "rewards"] } = {}) {
    const needle = String(query ?? "").toLowerCase();
    if (!needle) return [];
    const allowed = new Set(["id", "title", "subtitle", "description", "tasks", "rewards"]);
    const selected = fields.filter(field => allowed.has(field));
    if (!selected.length) throw new Error(`No searchable fields selected; use one of ${[...allowed].join(", ")}`);
    const results = [];
    for (const chapter of this.chapters) {
      for (const quest of chapter.quests) {
        const matches = [];
        const candidates = {
          id: quest.id,
          title: quest.title,
          subtitle: quest.subtitle,
          description: quest.description.join("\n"),
          tasks: JSON.stringify(quest.tasks),
          rewards: JSON.stringify(quest.rewards),
        };
        for (const field of selected) {
          const value = String(candidates[field] ?? "");
          if (value.toLowerCase().includes(needle)) matches.push({ field, value: value.slice(0, 400) });
        }
        if (matches.length) results.push({ id: quest.id, title: quest.title, chapterId: chapter.id, chapterTitle: chapter.title, matches });
      }
    }
    return results;
  }

  lint() {
    return lintStore(this);
  }
}

async function loadLocaleStrings(localeDir, locale) {
  const bytes = await readOptional(join(localeDir, `${locale}.snbt`));
  if (bytes === null) return Object.create(null);
  const parsed = parseSnbt(decodeUtf8(bytes, `lang/${locale}.snbt`), `lang/${locale}.snbt`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`lang/${locale}.snbt must contain a compound`);
  return parsed;
}

function buildQuest({ questRaw, chapterId, chapterFile, source, strings, fallbackStrings }) {
  const id = typeof questRaw.id === "string" ? questRaw.id : "";
  const localeTitle = localized(strings, fallbackStrings, `quest.${id}.title`);
  const localeSubtitle = localized(strings, fallbackStrings, `quest.${id}.quest_subtitle`);
  const localeDescription = localized(strings, fallbackStrings, `quest.${id}.quest_desc`);
  const inlineTitle = typeof questRaw.title === "string" ? questRaw.title : undefined;
  const inlineSubtitle = typeof questRaw.subtitle === "string" ? questRaw.subtitle : undefined;
  const titleSource = localeTitle !== undefined ? "locale" : inlineTitle !== undefined ? "inline" : "id";
  const title = localeTitle ?? inlineTitle ?? (id || "(missing id)");
  const subtitle = localeSubtitle ?? inlineSubtitle ?? "";
  const description = normalizeDescription(localeDescription ?? questRaw.quest_desc);
  return {
    id,
    chapterId,
    chapterFile,
    title: String(title),
    subtitle: String(subtitle),
    description,
    line: questLine(source, id),
    x: Number.isFinite(questRaw.x) ? questRaw.x : null,
    y: Number.isFinite(questRaw.y) ? questRaw.y : null,
    shape: typeof questRaw.shape === "string" ? questRaw.shape : "",
    size: Number.isFinite(questRaw.size) ? questRaw.size : null,
    icon: typeof questRaw.icon?.id === "string" ? questRaw.icon.id : "",
    minWidth: Number.isFinite(questRaw.min_width) ? questRaw.min_width : 0,
    dependencies: asArray(questRaw.dependencies).map(value => String(value)),
    tasks: asArray(questRaw.tasks),
    rewards: asArray(questRaw.rewards),
    titleSource,
    raw: questRaw,
  };
}

export function isKnownShape(shape) {
  return !shape || QUEST_SHAPES.includes(shape);
}

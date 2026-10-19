import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSnbt } from "../parse-snbt.mjs";

export async function readChapterGroups({ questDir, localeStrings = {}, fallbackStrings = {} }) {
  let source;
  try {
    const bytes = await readFile(join(questDir, "chapter_groups.snbt"));
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }

  const parsed = parseSnbt(source, "chapter_groups.snbt");
  const groups = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.chapter_groups) ? parsed.chapter_groups : [];
  return groups
    .filter(group => group && typeof group === "object" && typeof group.id === "string")
    .map(group => {
      const localized = localeStrings[`chapter_group.${group.id}.title`]
        ?? fallbackStrings[`chapter_group.${group.id}.title`]
        ?? group.title
        ?? group.id;
      return { id: group.id, title: String(localized) };
    });
}

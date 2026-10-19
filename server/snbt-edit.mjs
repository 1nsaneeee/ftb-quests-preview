import { parseSnbt } from "../parse-snbt.mjs";

function tokens(source, label) {
  const result = [];
  let offset = 0;
  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char) || char === ",") {
      if (char === ",") result.push({ value: char, start: offset, end: offset + 1, kind: "punctuation" });
      offset += 1;
      continue;
    }
    if (char === "#") {
      while (offset < source.length && source[offset] !== "\n") offset += 1;
      continue;
    }
    if ("{}[]:".includes(char)) {
      result.push({ value: char, start: offset, end: offset + 1, kind: "punctuation" });
      offset += 1;
      continue;
    }
    if (char === '"') {
      const start = offset++;
      let escaped = false;
      while (offset < source.length) {
        const current = source[offset++];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') break;
      }
      const raw = source.slice(start, offset);
      result.push({ value: JSON.parse(raw), start, end: offset, kind: "string" });
      continue;
    }
    const start = offset;
    while (offset < source.length && !/[\s{}\[\],:]/.test(source[offset])) offset += 1;
    if (start === offset) throw new SyntaxError(`${label}: invalid token at ${offset}`);
    result.push({ value: source.slice(start, offset), start, end: offset, kind: "bare" });
  }
  return result;
}

export function parseSnbtDocument(source, label = "SNBT") {
  const parsed = parseSnbt(source, label);
  const stream = tokens(source, label);
  let cursor = 0;
  const peek = value => stream[cursor]?.kind === "punctuation" && stream[cursor]?.value === value;
  const take = value => {
    const token = stream[cursor];
    if (!token || (value !== undefined && (token.kind !== "punctuation" || token.value !== value))) throw new SyntaxError(`${label}: malformed source near offset ${token?.start ?? source.length}`);
    cursor += 1;
    return token;
  };
  const skipCommas = () => { while (peek(",")) take(","); };

  function readValue() {
    const token = stream[cursor];
    if (!token) throw new SyntaxError(`${label}: unexpected end of source`);
    if (token.kind === "punctuation" && token.value === "{") {
      const open = take("{");
      const entries = new Map();
      skipCommas();
      while (!peek("}")) {
        const key = take();
        if (key.kind === "punctuation") throw new SyntaxError(`${label}: invalid compound key`);
        take(":");
        if (entries.has(key.value)) throw new SyntaxError(`${label}: duplicate key '${key.value}'`);
        entries.set(key.value, { key, node: readValue() });
        skipCommas();
      }
      const close = take("}");
      const node = { kind: "compound", start: open.start, end: close.end, closeStart: close.start, entries, value: Object.create(null) };
      for (const [name, entry] of entries) node.value[name] = entry.node.value;
      return node;
    }
    if (token.kind === "punctuation" && token.value === "[") {
      const open = take("[");
      const items = [];
      skipCommas();
      while (!peek("]")) {
        items.push(readValue());
        skipCommas();
      }
      const close = take("]");
      return { kind: "list", start: open.start, end: close.end, items, value: items.map(item => item.value) };
    }
    const first = take();
    if (first.kind === "punctuation") throw new SyntaxError(`${label}: invalid value`);
    let raw = first.value;
    let end = first.end;
    if (first.kind !== "string") {
      while (peek(":")) {
        take(":");
        const part = take();
        raw += `:${part.value}`;
        end = part.end;
      }
    }
    let value = raw;
    if (first.kind !== "string") {
      if (raw === "true") value = true;
      else if (raw === "false") value = false;
      else if (/^[+-]?\d+(?:\.\d+)?(?:[bBsSlLfFdD])?$/.test(raw)) value = Number(raw.replace(/[bBsSlLfFdD]$/, ""));
    }
    return { kind: "scalar", start: first.start, end, value };
  }

  const root = readValue();
  if (cursor !== stream.length) throw new SyntaxError(`${label}: unexpected trailing source`);
  if (JSON.stringify(root.value) !== JSON.stringify(parsed)) throw new SyntaxError(`${label}: source span parse disagrees with SNBT parser`);
  return root;
}

function findQuest(root, questId) {
  const quests = root.entries.get("quests")?.node;
  if (quests?.kind !== "list") return null;
  return quests.items.find(item => item.kind === "compound" && item.entries.get("id")?.node.value === questId) ?? null;
}

function literal(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return JSON.stringify(value);
  throw new TypeError("Unsupported SNBT edit value");
}

function insertion(source, compound, additions) {
  const closeLine = source.lastIndexOf("\n", compound.closeStart - 1) + 1;
  const closeIndent = source.slice(closeLine, compound.closeStart);
  const isOwnLine = /^[\t ]*$/.test(closeIndent);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (!isOwnLine) return { at: compound.closeStart, text: ` ${additions.map(([key, value]) => `${JSON.stringify(key)}: ${literal(value)}`).join(" ")} ` };
  const firstEntry = compound.entries.values().next().value;
  const entryLine = firstEntry ? source.lastIndexOf("\n", firstEntry.key.start - 1) + 1 : closeLine;
  const existingIndent = firstEntry ? source.slice(entryLine, firstEntry.key.start) : "";
  const indent = existingIndent || `${closeIndent}\t`;
  const body = additions.map(([key, value]) => `${indent}${JSON.stringify(key)}: ${literal(value)}`).join(newline);
  return { at: closeLine, text: `${body}${newline}` };
}

function applyEdits(source, edits) {
  edits.sort((left, right) => right.start - left.start || right.end - left.end);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

export function patchQuestSnbt(source, questId, fields, label = "chapter.snbt") {
  const root = parseSnbtDocument(source, label);
  const quest = findQuest(root, questId);
  if (!quest) throw new Error("Quest not found");
  const edits = [];
  const additions = [];
  for (const field of ["x", "y"]) {
    if (!Object.hasOwn(fields, field)) continue;
    const current = quest.entries.get(field)?.node;
    if (current && Object.is(current.value, fields[field])) continue;
    const text = literal(fields[field]);
    if (current) edits.push({ start: current.start, end: current.end, text });
    else additions.push([field, fields[field]]);
  }
  if (additions.length) {
    const edit = insertion(source, quest, additions);
    edits.push({ ...edit, start: edit.at, end: edit.at });
  }
  const output = applyEdits(source, edits);
  parseSnbt(output, label);
  return output;
}

export function patchLocaleSnbt(source, questId, fields, label = "lang.snbt") {
  const root = parseSnbtDocument(source, label);
  if (root.kind !== "compound") throw new Error("Locale root must be a compound");
  const edits = [];
  const additions = [];
  // FTB Quests reads quest text from `quest.<id>.title`, `quest.<id>.quest_subtitle`
  // and `quest.<id>.quest_desc`; keep these exact keys so the game picks the edits up.
  const keyNames = { title: "title", subtitle: "quest_subtitle", quest_desc: "quest_desc" };
  for (const field of ["title", "subtitle", "quest_desc"]) {
    if (!Object.hasOwn(fields, field)) continue;
    const key = `quest.${questId}.${keyNames[field]}`;
    const current = root.entries.get(key)?.node;
    if (current && JSON.stringify(current.value) === JSON.stringify(fields[field])) continue;
    const text = literal(fields[field]);
    if (current) edits.push({ start: current.start, end: current.end, text });
    else additions.push([key, fields[field]]);
  }
  if (additions.length) {
    const edit = insertion(source, root, additions);
    edits.push({ ...edit, start: edit.at, end: edit.at });
  }
  const output = applyEdits(source, edits);
  parseSnbt(output, label);
  return output;
}

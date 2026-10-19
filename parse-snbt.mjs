export function parseSnbt(source, label = "SNBT") {
  const tokens = tokenize(source, label);
  let cursor = 0;

  function fail(message, token = tokens[cursor]) {
    const offset = token?.offset ?? source.length;
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    throw new SyntaxError(`${label}:${line}:${column}: ${message}`);
  }

  function peek(value) {
    const token = tokens[cursor];
    return token?.kind === "punctuation" && token.value === value;
  }

  function take(value) {
    const token = tokens[cursor];
    if (!token || (value !== undefined && (token.kind !== "punctuation" || token.value !== value))) {
      fail(value === undefined ? "unexpected end of file" : `expected '${value}'`, token);
    }
    cursor += 1;
    return token;
  }

  function compound() {
    take("{");
    const object = Object.create(null);
    while (!peek("}")) {
      if (cursor >= tokens.length) fail("unterminated compound");
      if (peek(",")) {
        take(",");
        continue;
      }
      const keyToken = take();
      if (keyToken.kind === "punctuation") fail("expected a compound key", keyToken);
      take(":");
      if (Object.hasOwn(object, keyToken.value)) fail(`duplicate key '${keyToken.value}'`, keyToken);
      object[keyToken.value] = value();
    }
    take("}");
    return object;
  }

  function list() {
    take("[");
    const array = [];
    while (!peek("]")) {
      if (cursor >= tokens.length) fail("unterminated list");
      if (peek(",")) {
        take(",");
        continue;
      }
      array.push(value());
    }
    take("]");
    return array;
  }

  function value() {
    const token = take();
    if (token.kind === "string") return token.value;
    if (token.kind === "punctuation" && token.value === "{") {
      cursor -= 1;
      return compound();
    }
    if (token.kind === "punctuation" && token.value === "[") {
      cursor -= 1;
      return list();
    }
    if (token.kind === "punctuation") fail(`unsupported value '${token.value}'`, token);

    let bare = token.value;
    while (peek(":")) {
      take(":");
      const part = take();
      if (isPunctuation(part.value)) fail("invalid colon in bare value", part);
      bare += `:${part.value}`;
    }

    if (bare === "true") return true;
    if (bare === "false") return false;
    if (/^[+-]?\d+(?:\.\d+)?(?:[bBsSlLfFdD])?$/.test(bare)) {
      return Number(bare.replace(/[bBsSlLfFdD]$/, ""));
    }
    return bare;
  }

  const result = value();
  if (cursor !== tokens.length) fail("unexpected trailing token");
  return result;
}

function isPunctuation(value) {
  return ["{", "}", "[", "]", ",", ":"].includes(value);
}

function tokenize(source, label) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/.test(char) || char === ",") {
      if (char === ",") tokens.push({ value: char, offset: cursor, kind: "punctuation" });
      cursor += 1;
      continue;
    }
    if (char === "#") {
      while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if ("{}[]:".includes(char)) {
      tokens.push({ value: char, offset: cursor, kind: "punctuation" });
      cursor += 1;
      continue;
    }
    if (char === '"') {
      const start = cursor++;
      let escaped = false;
      while (cursor < source.length) {
        const current = source[cursor++];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') break;
      }
      if (source[cursor - 1] !== '"') {
        const before = source.slice(0, start);
        throw new SyntaxError(`${label}:${before.split("\n").length}: unterminated string`);
      }
      const raw = source.slice(start, cursor);
      let value;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        throw new SyntaxError(`${label}:${source.slice(0, start).split("\n").length}: invalid string escape (${error.message})`);
      }
      tokens.push({ value, offset: start, kind: "string" });
      continue;
    }

    const start = cursor;
    while (cursor < source.length && !/[\s{}\[\],:]/.test(source[cursor])) cursor += 1;
    if (cursor === start) throw new SyntaxError(`${label}: unable to parse token at offset ${cursor}`);
    tokens.push({ value: source.slice(start, cursor), offset: start, kind: "bare" });
  }
  return tokens;
}

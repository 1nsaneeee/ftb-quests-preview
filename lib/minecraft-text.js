const COLORS = {
  0: "#000000", 1: "#0000aa", 2: "#00aa00", 3: "#00aaaa",
  4: "#aa0000", 5: "#aa00aa", 6: "#ffaa00", 7: "#aaaaaa",
  8: "#555555", 9: "#5555ff", a: "#55ff55", b: "#55ffff",
  c: "#ff5555", d: "#ff55ff", e: "#ffff55", f: "#ffffff",
};

export function splitPages(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const pages = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "{@pagebreak}") {
      pages.push(lines.slice(start, index));
      start = index + 1;
    }
  }
  if (start < lines.length || pages.length === 0) pages.push(lines.slice(start));
  return pages;
}

export function tokenizeFormatting(text) {
  const tokens = [];
  let style = { color: "#ffffff", bold: false, italic: false, underline: false, strike: false, obfuscated: false };
  const reset = () => ({ color: "#ffffff", bold: false, italic: false, underline: false, strike: false, obfuscated: false });
  for (let index = 0; index < text.length;) {
    const marker = text[index];
    const code = text[index + 1]?.toLowerCase();
    if ((marker === "&" || marker === "§") && code) {
      if (code === "#" && /^#[0-9a-f]{6}/i.test(text.slice(index + 1, index + 8))) {
        style = { ...style, color: text.slice(index + 2, index + 8) };
        index += 8;
        continue;
      }
      if (Object.hasOwn(COLORS, code)) {
        style = { ...reset(), color: COLORS[code] };
        index += 2;
        continue;
      }
      if (code === "r") {
        style = reset();
        index += 2;
        continue;
      }
      const flags = { l: "bold", o: "italic", n: "underline", m: "strike", k: "obfuscated" };
      if (flags[code]) {
        style = { ...style, [flags[code]]: true };
        index += 2;
        continue;
      }
    }
    const character = String.fromCodePoint(text.codePointAt(index));
    tokens.push({ character, style: { ...style } });
    index += character.length;
  }
  return tokens;
}

export function pageElements(lines, innerWidth, advanceFor) {
  const elements = [];
  for (const line of lines) {
    if (line === "") {
      elements.push({ type: "space", height: 7 });
      continue;
    }
    const image = /^\{image:([^\s}]+)(?:\s+width:(\d+))?(?:\s+height:(\d+))?(?:\s+align:(left|center|right))?\}$/.exec(line);
    if (image) {
      elements.push({ type: "image", source: image[1], width: Number(image[2] ?? 96), height: Number(image[3] ?? 64), align: image[4] ?? "center" });
      continue;
    }
    const tokens = tokenizeFormatting(line);
    const wrapped = [];
    let current = [];
    let currentWidth = 0;
    for (const token of tokens) {
      const advance = advanceFor(token.character, token.style);
      if (current.length && currentWidth + advance > innerWidth) {
        const spaceAt = current.map(item => item.character).lastIndexOf(" ");
        if (spaceAt >= 0) {
          const next = current.slice(spaceAt + 1);
          wrapped.push(current.slice(0, spaceAt));
          current = next;
          currentWidth = current.reduce((sum, item) => sum + advanceFor(item.character, item.style), 0);
        } else {
          wrapped.push(current);
          current = [];
          currentWidth = 0;
        }
      }
      if (token.character !== " " || current.length) {
        current.push(token);
        currentWidth += advance;
      }
    }
    if (current.length || !wrapped.length) wrapped.push(current);
    elements.push({ type: "text", lines: wrapped });
  }
  return elements;
}

export class MinecraftText {
  constructor({ onInvalidate, onError }) {
    this.onInvalidate = onInvalidate;
    this.onError = onError;
    this.glyphs = new Map();
    this.minecraftGlyphs = new Map();
    this.tintedGlyphs = new Map();
    this.fallbackWidths = new Map();
    this.atlas = null;
    this.measureContext = document.createElement("canvas").getContext("2d");
    this.requestId = 0;
  }

  setAtlas(image) {
    this.atlas = image;
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const tileContext = tile.getContext("2d", { willReadFrequently: true });
    tileContext.drawImage(image, 0, 0, 128, 128);
    const pixels = tileContext.getImageData(0, 0, 128, 128).data;
    for (let code = 0; code < 256; code += 1) {
      const left = (code % 16) * 8;
      const top = Math.floor(code / 16) * 8;
      let right = -1;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          if (pixels[((top + y) * 128 + left + x) * 4 + 3] > 16) right = Math.max(right, x);
        }
      }
      this.glyphs.set(String.fromCodePoint(code), { x: left, y: top, width: right + 1 });
    }
    this.onInvalidate();
  }

  async loadGlyphs(text) {
    const requestId = ++this.requestId;
    const nonAscii = [...new Set(Array.from(text).filter(character => character.codePointAt(0) > 0x7f))].join("");
    if (!nonAscii) return;
    try {
      const response = await fetch(`/api/font?text=${encodeURIComponent(nonAscii)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      if (requestId !== this.requestId) return;
      for (const [hex, glyph] of Object.entries(payload.glyphs ?? {})) {
        const character = String.fromCodePoint(Number.parseInt(hex, 16));
        const bitmap = document.createElement("canvas");
        bitmap.width = 16;
        bitmap.height = 16;
        const bitmapContext = bitmap.getContext("2d");
        const pixels = bitmapContext.createImageData(16, 16);
        for (let y = 0; y < 16; y += 1) {
          const row = Number.parseInt(glyph.bitmap.slice(y * 4, y * 4 + 4), 16);
          for (let x = 0; x < 16; x += 1) {
            if ((row & (1 << (15 - x))) === 0) continue;
            const offset = (y * 16 + x) * 4;
            pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = pixels.data[offset + 3] = 255;
          }
        }
        bitmapContext.putImageData(pixels, 0, 0);
        this.minecraftGlyphs.set(character, { bitmap, advance: glyph.advance, height: glyph.height });
      }
      this.onInvalidate();
    } catch (error) {
      this.onError(error);
    }
  }

  #fallbackFont(style) {
    return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}9px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
  }

  #fallbackAdvance(character, style) {
    const key = `${character}:${style.italic ? 1 : 0}:${style.bold ? 1 : 0}`;
    if (!this.fallbackWidths.has(key)) {
      this.measureContext.font = this.#fallbackFont(style);
      this.fallbackWidths.set(key, Math.max(1, Math.ceil(this.measureContext.measureText(character).width)));
    }
    return this.fallbackWidths.get(key) + 1;
  }

  advance(character, style) {
    const gameGlyph = this.minecraftGlyphs.get(character);
    if (gameGlyph) return gameGlyph.advance + Number(style.bold);
    if (character === " ") return 4;
    const glyph = this.glyphs.get(character);
    if (glyph && this.atlas) return Math.max(0, glyph.width) + 1 + Number(style.bold);
    // No atlas: measure the browser fallback font so wrapping and drawing use the same advance.
    return this.#fallbackAdvance(character, style) + Number(style.bold);
  }

  wrap(text, width) {
    return pageElements([text], width, (character, style) => this.advance(character, style))[0].lines;
  }

  elements(lines, width) {
    return pageElements(lines, width, (character, style) => this.advance(character, style));
  }

  #tinted(character, color, bold) {
    const gameGlyph = this.minecraftGlyphs.get(character);
    const glyph = this.glyphs.get(character);
    if (!gameGlyph && (!glyph || glyph.width === 0 || !this.atlas)) return null;
    const key = `${character}:${color}:${bold}`;
    if (this.tintedGlyphs.has(key)) return this.tintedGlyphs.get(key);
    const output = document.createElement("canvas");
    // ASCII atlas tiles are 8x8. Keep the full tile width so a narrow glyph is
    // not stretched into the next character's advance; the transparent right
    // padding is what the following glyph's advance overlaps.
    output.width = gameGlyph ? 16 : 8 + Number(bold);
    output.height = gameGlyph ? 16 : 8;
    const context = output.getContext("2d");
    if (gameGlyph) context.drawImage(gameGlyph.bitmap, 0, 0);
    else context.drawImage(this.atlas, glyph.x, glyph.y, 8, 8, 0, 0, 8, 8);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, output.width, output.height);
    context.globalCompositeOperation = "source-over";
    if (bold) context.drawImage(output, 1, 0);
    this.tintedGlyphs.set(key, output);
    return output;
  }

  drawTokens(context, tokens, x, y) {
    let cursor = x;
    for (const token of tokens) {
      const { character, style } = token;
      const advance = this.advance(character, style);
      const sprite = this.#tinted(character, style.color, style.bold);
      if (sprite) {
        const gameGlyph = this.minecraftGlyphs.has(character);
        context.save();
        if (style.italic) context.transform(1, 0, -0.22, 1, Math.round(y * 0.22), 0);
        context.imageSmoothingEnabled = false;
        context.drawImage(sprite, cursor, y, gameGlyph ? 8 : sprite.width, gameGlyph ? 8 : sprite.height);
        if (style.underline || style.strike) {
          context.fillStyle = style.color;
          if (style.underline) context.fillRect(cursor, y + 8, Math.max(1, advance - 1), 1);
          if (style.strike) context.fillRect(cursor, y + 4, Math.max(1, advance - 1), 1);
        }
        context.restore();
      } else {
        context.fillStyle = style.color;
        context.font = this.#fallbackFont(style);
        context.textBaseline = "alphabetic";
        context.fillText(character, cursor, y + 8, Math.max(1, advance));
      }
      cursor += advance;
    }
  }

  destroy() {
    this.requestId += 1;
    this.tintedGlyphs.clear();
    this.minecraftGlyphs.clear();
    this.glyphs.clear();
    this.atlas = null;
  }
}

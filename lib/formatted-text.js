import { tokenizeFormatting } from "./minecraft-text.js";

export function plainText(value) {
  return tokenizeFormatting(value).map(token => token.character).join("");
}

// Use text nodes, never HTML: task packs are untrusted input. Title containers
// can already be buttons, so links are activated only in the detail preview.
export function renderFormattedText(element, value) {
  const fragment = document.createDocumentFragment();
  let previousStyle;
  let span;
  let textNode;
  for (const token of tokenizeFormatting(value, { color: "inherit" })) {
    const key = JSON.stringify(token.style);
    if (key !== previousStyle) {
      span = document.createElement("span");
      span.style.color = token.style.color;
      if (token.style.bold) span.style.fontWeight = "bold";
      if (token.style.italic) span.style.fontStyle = "italic";
      span.style.textDecoration = [token.style.underline && "underline", token.style.strike && "line-through"].filter(Boolean).join(" ");
      fragment.append(span);
      textNode = document.createTextNode("");
      span.append(textNode);
      previousStyle = key;
    }
    textNode.appendData(token.character);
  }
  element.replaceChildren(fragment);
}

export function drawFormattedText(context, value, x, y, { size = 11, color = "#ffffff", maxWidth = Infinity, align = "left", bold = false } = {}) {
  context.save();
  const tokens = tokenizeFormatting(value, { color, bold });
  const fontFor = style => `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${size}px 'Microsoft YaHei UI', 'Segoe UI', sans-serif`;
  const widths = tokens.map(token => {
    context.font = fontFor(token.style);
    return context.measureText(token.character).width;
  });
  const total = widths.reduce((sum, width) => sum + width, 0);
  const scale = total > 0 ? Math.min(1, maxWidth / total) : 1;
  let cursor = align === "center" ? x - total * scale / 2 : x;
  context.textAlign = "left";
  context.textBaseline = "top";
  for (const [index, token] of tokens.entries()) {
    const width = widths[index] * scale;
    context.font = fontFor(token.style);
    context.fillStyle = token.style.color;
    context.fillText(token.character, cursor, y, Math.max(.01, width));
    if (token.style.underline) context.fillRect(cursor, y + size, width, 1);
    if (token.style.strike) context.fillRect(cursor, y + size / 2, width, 1);
    cursor += width;
  }
  context.restore();
}

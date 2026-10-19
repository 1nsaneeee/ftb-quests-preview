import { pickedCompletion, snippetCompletion } from "@codemirror/autocomplete";

const COLOR_CODES = [
  ["0", "黑色", "#000000"], ["1", "深蓝", "#0000aa"], ["2", "深绿", "#00aa00"], ["3", "湖蓝", "#00aaaa"],
  ["4", "深红", "#aa0000"], ["5", "紫色", "#aa00aa"], ["6", "金色", "#ffaa00"], ["7", "浅灰", "#aaaaaa"],
  ["8", "深灰", "#555555"], ["9", "蓝色", "#5555ff"], ["a", "绿色", "#55ff55"], ["b", "青色", "#55ffff"],
  ["c", "红色", "#ff5555"], ["d", "粉色", "#ff55ff"], ["e", "黄色", "#ffff55"], ["f", "白色", "#ffffff"],
];

const FORMAT_CODES = [
  ...COLOR_CODES.map(([code, name, color]) => ({ code, detail: name, color })),
  { code: "k", detail: "混淆文字" }, { code: "l", detail: "粗体" }, { code: "m", detail: "删除线" },
  { code: "n", detail: "下划线" }, { code: "o", detail: "斜体" }, { code: "r", detail: "重置格式" },
];

const FORMAT_ALIASES = [
  { label: "gold", apply: "&6", detail: "金色" },
  { label: "bold", apply: "&l", detail: "粗体" },
  { label: "reset", apply: "&r", detail: "重置格式" },
];

const PAGEBREAK = "{@pagebreak}";
const IMAGE_TEMPLATE = "\\{image:${1:resource_id} width:${2:96} height:${3:64} align:${4:center}\\}";

function imageOption(label) {
  return snippetCompletion(IMAGE_TEMPLATE, {
    label,
    detail: "插入图片（填写资源 ID）",
    type: "text",
  });
}

function pageBreakOption(label) {
  return {
    label,
    detail: "插入独占一行的分页符",
    type: "keyword",
    apply(view, completion, from, to) {
      const { state } = view;
      const firstLine = state.doc.lineAt(from);
      const lastLine = state.doc.lineAt(to);
      const leading = state.doc.sliceString(firstLine.from, from);
      const trailing = state.doc.sliceString(to, lastLine.to);
      const hasLeadingText = leading.trim().length > 0;
      const replaceFrom = hasLeadingText ? from : firstLine.from;
      const preserveTrailing = trailing.length > 0;
      const prefix = hasLeadingText ? "\n" : "";
      const suffix = preserveTrailing ? "\n" : "";
      const insert = `${prefix}${PAGEBREAK}${suffix}`;
      view.dispatch({
        changes: { from: replaceFrom, to, insert },
        selection: { anchor: replaceFrom + prefix.length + PAGEBREAK.length },
        annotations: pickedCompletion.of(completion),
      });
    },
  };
}

function formatOption(marker, { code, detail, color }) {
  return {
    label: `${marker}${code}`,
    detail,
    type: color ? "color" : "text",
    ...(color ? { color } : {}),
  };
}

function aliasOption({ label, apply, detail }) {
  return { label, apply, detail, type: "text" };
}

function lineContext(context) {
  const line = context.state.doc.lineAt(context.pos);
  const offset = context.pos - line.from;
  return {
    line,
    prefix: line.text.slice(0, offset),
    suffix: line.text.slice(offset),
    blankAround: line.text.trim().length === 0,
  };
}

function isStandaloneMatch(line, match) {
  const before = line.text.slice(0, match.from - line.from);
  const after = line.text.slice(match.to - line.from);
  return !before.trim() && !after.trim();
}

export function descriptionCompletionSource(context) {
  if (context.view?.composing) return null;
  const { line, prefix, suffix, blankAround } = lineContext(context);
  const formatMatch = context.matchBefore(/[&§][0-9a-fklmnor]?/i);
  if (formatMatch) {
    const marker = formatMatch.text[0];
    return {
      from: formatMatch.from,
      options: FORMAT_CODES.map(code => formatOption(marker, code)),
    };
  }

  const braceMatch = context.matchBefore(/\{[^{}\s]*/);
  if (braceMatch) {
    const options = [pageBreakOption(PAGEBREAK)];
    if (isStandaloneMatch(line, braceMatch)) options.push(imageOption("{image:…}"));
    return { from: braceMatch.from, options };
  }

  const wordMatch = context.matchBefore(/[a-z]+/i);
  if (wordMatch) {
    const beforeWord = line.text.slice(0, wordMatch.from - line.from);
    if (!/[&§{]$/.test(beforeWord)) {
      const options = [
        ...FORMAT_ALIASES.map(aliasOption),
        pageBreakOption("page"),
      ];
      if (isStandaloneMatch(line, wordMatch)) options.push(imageOption("img"));
      return { from: wordMatch.from, options };
    }
  }

  if (!context.explicit) return null;
  const options = [
    ...FORMAT_CODES.map(code => formatOption("&", code)),
    ...FORMAT_ALIASES.map(aliasOption),
    pageBreakOption("page"),
    pageBreakOption(PAGEBREAK),
  ];
  if (blankAround) options.push(imageOption("img"), imageOption("{image:…}"));
  return { from: context.pos, options, filter: false };
}

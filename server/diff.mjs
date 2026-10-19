const MAX_DIFF_CELLS = 2_000_000;

/**
 * A small line diff for dry-run previews. Returns unified-style hunks with
 * three lines of context. Large inputs fall back to a truncation marker rather
 * than allocating a huge LCS table.
 */
export function diffLines(before, after, context = 3) {
  const split = text => text === "" ? [] : text.split(/\r?\n/);
  const a = split(before);
  const b = split(after);
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return { hunks: [], truncated: true, oldLines: a.length, newLines: b.length };
  }

  const lengthA = a.length;
  const lengthB = b.length;
  const table = Array.from({ length: lengthA + 1 }, () => new Uint32Array(lengthB + 1));
  for (let i = lengthA - 1; i >= 0; i -= 1) {
    for (let j = lengthB - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < lengthA && j < lengthB) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "-", text: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "+", text: b[j] });
      j += 1;
    }
  }
  while (i < lengthA) { ops.push({ kind: "-", text: a[i] }); i += 1; }
  while (j < lengthB) { ops.push({ kind: "+", text: b[j] }); j += 1; }

  const changed = [];
  ops.forEach((op, index) => { if (op.kind !== " ") changed.push(index); });
  if (!changed.length) return { hunks: [], truncated: false, oldLines: lengthA, newLines: lengthB };

  const groups = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(ops.length - 1, changed[0] + context);
  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) end = Math.min(ops.length - 1, index + context);
    else {
      groups.push([start, end]);
      start = Math.max(0, index - context);
      end = Math.min(ops.length - 1, index + context);
    }
  }
  groups.push([start, end]);

  const hunks = groups.map(([from, to]) => {
    const lines = ops.slice(from, to + 1);
    const oldStart = ops.slice(0, from).filter(op => op.kind !== "+").length + 1;
    const newStart = ops.slice(0, from).filter(op => op.kind !== "-").length + 1;
    return {
      oldStart,
      oldLines: lines.filter(op => op.kind !== "+").length,
      newStart,
      newLines: lines.filter(op => op.kind !== "-").length,
      lines: lines.map(op => `${op.kind}${op.text}`),
    };
  });
  return { hunks, truncated: false, oldLines: lengthA, newLines: lengthB };
}

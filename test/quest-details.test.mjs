import test from "node:test";
import assert from "node:assert/strict";
import { QuestDetails } from "../components/quest-details.js";

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
};
let latestResizeObserver;
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; latestResizeObserver = this; }
  observe(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
};

function makeCanvas() {
  const listeners = new Map();
  const drawnText = [];
  const context = {
    fillStyle: "",
    font: "",
    textBaseline: "",
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    setTransform() {},
    fillRect() {},
    fillText(text, x, y) { drawnText.push({ text, x, y }); },
    strokeRect() {},
    drawImage() {},
    createPattern() { return null; },
    measureText(text) { return { width: text.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }; },
  };
  return {
    style: {}, width: 0, height: 0,
    getContext() { return context; },
    drawnText,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() { return this.rect; },
    rect: { left: 100, top: 120, width: 1000, height: 600 },
    dispatch(type, event) { listeners.get(type)?.(event); },
    listeners,
  };
}

function makeDetails({ onPageChange = () => {}, onPageInfo = () => {} } = {}) {
  const canvas = makeCanvas();
  const scroll = { clientWidth: 1000, clientHeight: 600, addEventListener() {}, removeEventListener() {} };
  const details = new QuestDetails({
    canvas,
    scroll,
    stage: { style: {} },
    canvasSize: { textContent: "" },
    getAsset: () => null,
    textRenderer: { elements: lines => lines.map(line => ({ type: "text", lines: [line] })), drawTokens() {} },
    onPageInfo,
    onPageChange,
  });
  details.mount();
  return { canvas, details, scroll, resizeObserver: latestResizeObserver };
}

function snapshot(page, guiScale) {
  return {
    selected: { quest: { title: "Quest", tasks: [], rewards: [] } },
    draft: "A\n{@pagebreak}\nB",
    page,
    logicalWidth: 220,
    guiScale,
  };
}

function clickCanvasPage(canvas, guiScale, x, y) {
  canvas.dispatch("click", {
    clientX: canvas.rect.left + x * guiScale,
    clientY: canvas.rect.top + y * guiScale,
  });
}

function clickDrawnText(canvas, guiScale, text, dx = 6, dy = -4) {
  const drawn = canvas.drawnText.findLast(entry => entry.text === text);
  assert.ok(drawn, `expected canvas text ${text}`);
  clickCanvasPage(canvas, guiScale, drawn.x + dx, drawn.y + dy);
}

test("canvas Next changes to the next page at GUI scales 1, 2, and 4", () => {
  for (const scale of [1, 2, 4]) {
    const changedPages = [];
    const infos = [];
    const { canvas, details } = makeDetails({
      onPageChange: page => changedPages.push(page),
      onPageInfo: (page, count) => infos.push([page, count]),
    });
    details.update(snapshot(0, scale));
    assert.deepEqual(infos.at(-1), [0, 2]);

    clickDrawnText(canvas, scale, "下一页 ›");
    assert.deepEqual(changedPages, [1], `scale ${scale}`);
    details.destroy();
  }
});

test("canvas paging uses the current canvas rect after scrolling and does not expose disabled directions", () => {
  const changedPages = [];
  const { canvas, details } = makeDetails({ onPageChange: page => changedPages.push(page) });
  details.update(snapshot(0, 2));
  canvas.rect = { ...canvas.rect, left: -320, top: -80 };
  clickDrawnText(canvas, 2, "下一页 ›");
  assert.deepEqual(changedPages, [1]);

  details.update(snapshot(1, 2));
  clickDrawnText(canvas, 2, "下一页 ›");
  assert.deepEqual(changedPages, [1], "last page has no active Next hit area");
  clickDrawnText(canvas, 2, "‹ 上一页", 0, -4);
  assert.deepEqual(changedPages, [1, 0]);

  details.update(snapshot(0, 2));
  clickDrawnText(canvas, 2, "‹ 上一页", 0, -4);
  assert.deepEqual(changedPages, [1, 0], "first page has no active Previous hit area");
  details.destroy();
});

test("resizing the preview scroll viewport redraws the canvas without a window resize", () => {
  const infos = [];
  const { canvas, details, scroll, resizeObserver } = makeDetails({ onPageInfo: (...info) => infos.push(info) });
  details.update(snapshot(0, 1));
  const previousDrawCount = infos.length;

  scroll.clientWidth = 600;
  resizeObserver.callback();
  assert.equal(canvas.style.width, "600px");
  assert.equal(infos.length, previousDrawCount + 1);

  details.destroy();
  assert.equal(resizeObserver.disconnected, true);
});

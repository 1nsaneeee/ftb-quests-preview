import { QuestDetails } from "./components/quest-details.js";
import { QuestEditor } from "./components/quest-editor.js";
import { PreviewControls, normalizeWidth, widthBoundsFor } from "./components/preview-controls.js";
import { QuestMap } from "./components/quest-map.js";
import { QuestNavigation } from "./components/quest-navigation.js";
import { MinecraftText, splitPages } from "./lib/minecraft-text.js";

const ui = {
  chapterList: document.querySelector("#chapterList"), search: document.querySelector("#search"),
  sourcePath: document.querySelector("#sourcePath"), connectionState: document.querySelector("#connectionState"),
  questCount: document.querySelector("#questCount"), locale: document.querySelector("#locale"),
  panelWidth: document.querySelector("#panelWidth"), panelWidthNumber: document.querySelector("#panelWidthNumber"), widthEnds: document.querySelector("#widthEnds"),
  scaleGroup: document.querySelector("#guiScaleGroup"), scaleButtons: [...document.querySelectorAll("[data-scale]")],
  pageValue: document.querySelector("#pageValue"), prevPage: document.querySelector("#prevPage"), nextPage: document.querySelector("#nextPage"),
  draft: document.querySelector("#draft"), resetDraft: document.querySelector("#resetDraft"),
  crumbGroup: document.querySelector("#crumbGroup"), crumbChapter: document.querySelector("#crumbChapter"), crumbQuest: document.querySelector("#crumbQuest"),
  renderNote: document.querySelector("#renderNote"), canvasSize: document.querySelector("#canvasSize"),
  canvasScroll: document.querySelector("#canvasScroll"), canvasStage: document.querySelector("#canvasStage"),
  detailsViewButton: document.querySelector("#detailsViewButton"), mapViewButton: document.querySelector("#mapViewButton"),
  graphView: document.querySelector("#graphView"), graphStage: document.querySelector("#graphStage"),
  graphCanvas: document.querySelector("#graphCanvas"), graphChapter: document.querySelector("#graphChapter"),
  toggleGraphLabels: document.querySelector("#toggleGraphLabels"), toggleGraphEditing: document.querySelector("#toggleGraphEditing"),
  editorRoot: document.querySelector("#questEditor"),
  graphZoomValue: document.querySelector("#graphZoomValue"), crossChapterDeps: document.querySelector("#crossChapterDeps"),
  graphEmpty: document.querySelector("#graphEmpty"), zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"), fitGraph: document.querySelector("#fitGraph"), canvasFooter: document.querySelector(".canvas-footer"),
};

const state = {
  data: null,
  selectedQuestId: new URLSearchParams(location.search).get("quest") || "",
  page: 0,
  pageCount: 1,
  logicalWidth: 220,
  guiScale: 1,
  draft: "",
  editorDrafts: new Map(),
  editing: false,
  snapGrid: true,
  saving: false,
  editorMessage: "",
  editorError: false,
  externalUpdate: false,
  saveConflict: false,
  view: "details",
};

const assets = new Map();
const invalidators = new Set();
let eventSource;
let disposed = false;

function status(message, error = false) {
  ui.connectionState.textContent = message;
  ui.connectionState.classList.toggle("error", error);
}

function getAsset(location, onReady) {
  if (!location) return null;
  if (!assets.has(location)) {
    const image = new Image();
    image.src = `/api/asset?location=${encodeURIComponent(location)}`;
    image.addEventListener("load", invalidateAll, { once: true });
    image.addEventListener("error", invalidateAll, { once: true });
    assets.set(location, image);
  }
  const image = assets.get(location);
  if (onReady) {
    if (image.complete && image.naturalWidth) onReady(image);
    else image.addEventListener("load", () => onReady(image), { once: true });
  }
  return image;
}

function invalidateAll() {
  for (const invalidate of invalidators) invalidate();
}

const textRenderer = new MinecraftText({
  onInvalidate: invalidateAll,
  onError: error => status(`字体读取失败: ${error.message}`, true),
});

const details = new QuestDetails({
  canvas: document.querySelector("#questCanvas"),
  scroll: ui.canvasScroll,
  stage: ui.canvasStage,
  canvasSize: ui.canvasSize,
  getAsset,
  textRenderer,
  onPageInfo: (page, count) => {
    state.pageCount = count;
    state.page = page;
    controls.update(controlSnapshot());
  },
});

function descriptionText(description) {
  if (Array.isArray(description)) return description.map(line => String(line ?? "")).join("\n");
  if (description === undefined || description === null) return "";
  return String(description);
}

function findBaseQuest(questId = state.selectedQuestId, data = state.data) {
  if (!data) return null;
  for (const chapter of data.chapters) {
    const quest = chapter.quests.find(candidate => candidate.id === questId);
    if (quest) return { chapter, quest };
  }
  return null;
}

function editKey(questId, locale = state.data?.locale) {
  return `${locale}:${questId}`;
}

function findQuest(questId = state.selectedQuestId) {
  const found = findBaseQuest(questId);
  if (!found) return null;
  const patch = state.editorDrafts.get(editKey(questId));
  return patch ? { ...found, quest: { ...found.quest, ...patch } } : found;
}

function effectiveData() {
  if (!state.data) return null;
  return {
    ...state.data,
    chapters: state.data.chapters.map(chapter => ({
      ...chapter,
      quests: chapter.quests.map(quest => {
        const patch = state.editorDrafts.get(editKey(quest.id));
        return patch ? { ...quest, ...patch } : quest;
      }),
    })),
  };
}

function changedQuestCount(locale = state.data?.locale) {
  const prefix = `${locale}:`;
  return [...state.editorDrafts.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .reduce((sum, [, patch]) => sum + Object.keys(patch).length, 0);
}

function hasAnyChanges() {
  return [...state.editorDrafts.values()].some(patch => Object.keys(patch).length > 0);
}

function selectedSnapshot() {
  const selected = findQuest();
  return selected ? { ...selected, data: effectiveData() } : null;
}

function controlSnapshot() {
  const selected = findQuest();
  return {
    locale: state.data?.locale ?? "en_us",
    supportedLocales: state.data?.supportedLocales ?? [],
    logicalWidth: state.logicalWidth,
    minWidth: selected?.quest.minWidth ?? 180,
    guiScale: state.guiScale,
    page: state.page,
    pageCount: state.pageCount,
    draft: descriptionText(findQuest()?.quest.description ?? []),
  };
}

function renderCrumbs() {
  const selected = findQuest();
  if (!selected) return;
  const group = state.data.chapterGroups?.find(candidate => candidate.id === selected.chapter.group);
  ui.crumbGroup.textContent = group?.title ?? "未分组";
  ui.crumbChapter.textContent = selected.chapter.title;
  ui.crumbQuest.textContent = selected.quest.title;
  ui.renderNote.textContent = `FTB Quests · ${state.data.locale} · 离线近似`;
}

function render() {
  if (!state.data) return;
  const viewData = effectiveData();
  const selected = findQuest();
  const widthBounds = widthBoundsFor(selected?.quest.minWidth);
  state.logicalWidth = normalizeWidth(state.logicalWidth, widthBounds);
  state.draft = descriptionText(selected?.quest.description ?? []);
  navigation.update(viewData, state.selectedQuestId);
  renderCrumbs();
  controls.update(controlSnapshot());
  details.update({ selected: selectedSnapshot(), draft: state.draft, page: state.page, logicalWidth: state.logicalWidth, guiScale: state.guiScale });
  map.update(viewData, state.selectedQuestId, { editing: state.editing, snapGrid: state.snapGrid, saving: state.saving });
  editor.update({
    selected,
    enabled: Boolean(state.data.editing?.enabled),
    editing: Boolean(state.data?.editing?.enabled) && Boolean(selected),
    snapGrid: state.snapGrid,
    changedCount: changedQuestCount(),
    saving: state.saving,
    message: state.editorMessage,
    error: state.editorError,
    saveConflict: state.saveConflict,
  });
  ui.draft.disabled = state.saving;
  ui.resetDraft.disabled = state.saving;
}

function setView(view) {
  state.view = view;
  const isMap = view === "map";
  ui.canvasScroll.classList.toggle("view-hidden", isMap);
  ui.canvasFooter.classList.toggle("view-hidden", isMap);
  ui.graphView.classList.toggle("hidden", !isMap);
  ui.detailsViewButton.classList.toggle("active", !isMap);
  ui.detailsViewButton.setAttribute("aria-pressed", String(!isMap));
  ui.mapViewButton.classList.toggle("active", isMap);
  ui.mapViewButton.setAttribute("aria-pressed", String(isMap));
  if (isMap) map.render();
}

function switchQuest(questId) {
  if (questId === state.selectedQuestId) return;
  state.selectedQuestId = questId;
  state.page = 0;
  render();
  history.replaceState(null, "", `?quest=${encodeURIComponent(questId)}`);
}

function setQuestChanges(changes, questId = state.selectedQuestId) {
  if (state.saving) return;
  const selected = findBaseQuest(questId);
  if (!selected) return;
  const key = editKey(selected.quest.id);
  const next = { ...(state.editorDrafts.get(key) ?? {}) };
  for (const [field, value] of Object.entries(changes)) {
    const normalized = field === "description" ? (Array.isArray(value) ? value : String(value ?? "").split("\n")) : value;
    const baseline = selected.quest[field];
    const equal = field === "description"
      ? JSON.stringify(normalized) === JSON.stringify(Array.isArray(baseline) ? baseline : baseline == null ? [] : [String(baseline)])
      : normalized === baseline;
    if (equal) delete next[field];
    else next[field] = normalized;
  }
  if (Object.keys(next).length) state.editorDrafts.set(key, next);
  else state.editorDrafts.delete(key);
  state.editorMessage = state.externalUpdate ? "检测到源文件外部更新；保存前请重新载入。" : "";
  state.editorError = Boolean(state.externalUpdate);
  if (Object.keys(next).length && !state.data?.editing?.enabled) state.editorMessage = "当前数据源仅支持本地预览，未启用写回。";
  state.page = 0;
  void textRenderer.loadGlyphs(descriptionText(findQuest()?.quest.description ?? []));
  render();
}

async function loadData(locale = ui.locale.value || "en_us") {
  try {
    const response = await fetch(`/api/data?locale=${encodeURIComponent(locale)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    const previousId = state.selectedQuestId;
    state.data = payload;
    state.selectedQuestId = previousId;
    if (!findQuest(previousId)) state.selectedQuestId = payload.chapters.flatMap(chapter => chapter.quests)[0]?.id ?? "";
    const selected = findQuest();
    state.page = 0;
    state.externalUpdate = false;
    state.saveConflict = false;
    if (!hasAnyChanges()) state.editorMessage = "";
    state.draft = descriptionText(selected?.quest.description ?? []);
    void textRenderer.loadGlyphs(state.draft);
    ui.sourcePath.textContent = `${payload.files.chapters} · ${payload.files.locale}`;
    ui.questCount.textContent = String(payload.chapters.reduce((sum, chapter) => sum + chapter.quests.length, 0)).padStart(2, "0");
    status("已连接");
    render();
  } catch (error) {
    status("读取失败", true);
    details.showError(error.message);
  }
}

const navigation = new QuestNavigation({
  root: ui.chapterList,
  search: ui.search,
  getAsset,
  onSelect: switchQuest,
});

const controls = new PreviewControls({
  locale: ui.locale, panelWidth: ui.panelWidth, panelWidthNumber: ui.panelWidthNumber, widthEnds: ui.widthEnds,
  scaleGroup: ui.scaleGroup, scaleButtons: ui.scaleButtons, pageValue: ui.pageValue, prevPage: ui.prevPage, nextPage: ui.nextPage,
  draft: ui.draft, resetDraft: ui.resetDraft,
}, {
  locale: async locale => {
    if (state.saving || changedQuestCount() > 0) {
      state.editorMessage = state.saving ? "保存完成前不能切换语言。" : "当前语言有未保存更改；请先保存或放弃，再切换语言。";
      state.editorError = true;
      render();
      return;
    }
    state.editorMessage = "";
    state.editorError = false;
    await loadData(locale);
  },
  width: value => { state.logicalWidth = value; render(); },
  scale: value => { state.guiScale = value; render(); },
  page: delta => {
    const pages = splitPages(state.draft);
    state.page = Math.max(0, Math.min(pages.length - 1, state.page + delta));
    render();
  },
  draft: value => {
    setQuestChanges({ description: value.split("\n") });
  },
  resetDraft: () => {
    const selected = findBaseQuest();
    if (!selected) return;
    setQuestChanges({ description: Array.isArray(selected.quest.description) ? selected.quest.description : [] });
  },
});

const map = new QuestMap({
  stage: ui.graphStage,
  canvas: ui.graphCanvas,
  chapterSelect: ui.graphChapter,
  labelToggle: ui.toggleGraphLabels,
  editToggle: ui.toggleGraphEditing,
  zoomValue: ui.graphZoomValue,
  crossDeps: ui.crossChapterDeps,
  empty: ui.graphEmpty,
  getAsset,
  onOpenQuest: questId => {
    switchQuest(questId);
    if (!state.editing) setView("details");
  },
  onToggleEditing: editing => {
    state.editing = editing;
    state.editorMessage = editing && !state.data?.editing?.enabled ? "此数据源未启用保存。" : "";
    state.editorError = false;
    render();
  },
  onMoveQuest: (questId, x, y) => {
    setQuestChanges({ x, y }, questId);
  },
});

const editor = new QuestEditor(ui.editorRoot, {
  change: changes => setQuestChanges(changes),
  snap: value => { state.snapGrid = value; render(); },
  save: saveChanges,
  discard: discardChanges,
});

async function saveChanges() {
  if (!state.data?.editing?.enabled || state.saving || state.saveConflict) return;
  const locale = state.data.locale;
  const prefix = `${locale}:`;
  const changes = [...state.editorDrafts.entries()]
    .filter(([key, patch]) => key.startsWith(prefix) && Object.keys(patch).length)
    .map(([key, patch]) => ({ questId: key.slice(prefix.length), ...patch }));
  if (!changes.length) return;
  state.saving = true;
  state.editorMessage = "正在保存并创建备份…";
  state.editorError = false;
  render();
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Quest-Preview-Token": state.data.editing.token ?? "",
      },
      body: JSON.stringify({ locale, revisions: state.data.editing.revisions, changes }),
    });
    const payload = await response.json();
    if (response.status === 409) {
      state.externalUpdate = true;
      state.saveConflict = true;
      state.editorMessage = payload.error ?? "源文件已改变，草稿保留。请重新载入后再编辑。";
      state.editorError = true;
      return;
    }
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    if (!payload.saved || !payload.data) throw new Error("保存响应缺少最新任务数据。");
    state.data = payload.data;
    for (const key of [...state.editorDrafts.keys()]) if (key.startsWith(prefix)) state.editorDrafts.delete(key);
    state.externalUpdate = false;
    state.saveConflict = false;
    const backups = Array.isArray(payload.backups) ? payload.backups : [];
    state.editorMessage = `已保存。备份：${backups.join("、") || "后端未返回路径"}`;
    state.editorError = false;
    status("已连接");
  } catch (error) {
    state.editorMessage = `保存失败：${error.message}。草稿仍保留。`;
    state.editorError = true;
  } finally {
    state.saving = false;
    render();
  }
}

async function discardChanges() {
  const locale = state.data?.locale;
  if (!locale) return;
  if (!window.confirm(`放弃 ${locale} 的所有未保存更改，并重新载入源文件？`)) return;
  const prefix = `${locale}:`;
  for (const key of [...state.editorDrafts.keys()]) if (key.startsWith(prefix)) state.editorDrafts.delete(key);
  state.externalUpdate = false;
  state.saveConflict = false;
  state.editorMessage = "正在重新载入…";
  state.editorError = false;
  await loadData(locale);
}

function onZoomIn() { map.zoomBy(1.2); }
function onZoomOut() { map.zoomBy(1 / 1.2); }
function onFitGraph() { map.fit(); }
function onDetailsView() { setView("details"); }
function onMapView() { setView("map"); }
function onKeyDown(event) {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    ui.search.focus();
  }
  if (event.key === "ArrowLeft" && event.altKey) controls.handlers.page(-1);
  if (event.key === "ArrowRight" && event.altKey) controls.handlers.page(1);
}

function destroy() {
  if (disposed) return;
  disposed = true;
  eventSource?.close();
  details.destroy();
  navigation.destroy();
  controls.destroy();
  editor.destroy();
  map.destroy();
  textRenderer.destroy();
  ui.zoomIn.removeEventListener("click", onZoomIn);
  ui.zoomOut.removeEventListener("click", onZoomOut);
  ui.fitGraph.removeEventListener("click", onFitGraph);
  ui.detailsViewButton.removeEventListener("click", onDetailsView);
  ui.mapViewButton.removeEventListener("click", onMapView);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  invalidators.clear();
}

function onBeforeUnload(event) {
  if (hasAnyChanges()) {
    event.preventDefault();
    event.returnValue = "";
    return;
  }
  destroy();
}

navigation.mount();
controls.mount();
editor.mount();
details.mount();
map.mount();
invalidators.add(() => details.draw());
invalidators.add(() => map.render());
ui.zoomIn.addEventListener("click", onZoomIn);
ui.zoomOut.addEventListener("click", onZoomOut);
ui.fitGraph.addEventListener("click", onFitGraph);
ui.detailsViewButton.addEventListener("click", onDetailsView);
ui.mapViewButton.addEventListener("click", onMapView);
document.addEventListener("keydown", onKeyDown);
window.addEventListener("beforeunload", onBeforeUnload);

eventSource = new EventSource("/api/events");
eventSource.addEventListener("open", () => status("已连接"));
eventSource.addEventListener("error", () => status("等待服务…", true));
eventSource.addEventListener("reload", () => {
  if (changedQuestCount() > 0) {
    state.externalUpdate = true;
    state.editorMessage = "源文件已变化；当前草稿仍保留。保存会检测冲突，或放弃并重新载入。";
    state.editorError = true;
    render();
    return;
  }
  void loadData(state.data?.locale ?? "en_us");
});
void loadData();

const KNOWN_SHAPES = new Set(["circle", "square", "hexagon", "gear"]);

export class QuestMap {
  constructor({ stage, canvas, chapterSelect, zoomValue, crossDeps, empty, labelToggle, editToggle, getAsset, onOpenQuest, onToggleEditing, onMoveQuest }) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.chapterSelect = chapterSelect;
    this.zoomValue = zoomValue;
    this.crossDeps = crossDeps;
    this.empty = empty;
    this.labelToggle = labelToggle;
    this.editToggle = editToggle;
    this.getAsset = getAsset;
    this.onOpenQuest = onOpenQuest;
    this.onToggleEditing = onToggleEditing;
    this.onMoveQuest = onMoveQuest;
    this.editing = false;
    this.snapGrid = true;
    this.data = null;
    this.chapterId = "";
    this.selectedQuestId = "";
    this.zoom = 1;
    this.transform = null;
    this.nodeHitboxes = [];
    this.drag = null;
    this.suppressClick = false;
    this.showLabels = false;
    this.hoveredQuestId = "";
    this.destroyed = false;
    this.handleResize = () => this.render();
    this.handleChapter = () => {
      this.chapterId = this.chapterSelect.value;
      this.transform = null;
      this.renderCrossChapterDependencies();
      this.render();
    };
    this.handlePointerDown = event => this.pointerDown(event);
    this.handlePointerMove = event => this.pointerMove(event);
    this.handlePointerUp = event => this.pointerUp(event);
    this.handleWheel = event => this.wheel(event);
    this.handleClick = event => this.click(event);
    this.handleKeyDown = event => this.keyDown(event);
    this.handlePointerLeave = () => {
      this.hoveredQuestId = "";
      this.canvas.removeAttribute("title");
      this.render();
    };
    this.handleLabels = () => {
      this.showLabels = !this.showLabels;
      this.labelToggle.setAttribute("aria-pressed", String(this.showLabels));
      this.labelToggle.textContent = this.showLabels ? "隐藏名称" : "显示名称";
      this.render();
    };
    this.handleEditToggle = () => {
      this.editing = !this.editing;
      this.editToggle.setAttribute("aria-pressed", String(this.editing));
      this.editToggle.textContent = this.editing ? "退出编辑" : "编辑布局";
      this.stage.classList.toggle("editing-layout", this.editing);
      this.onToggleEditing(this.editing);
      this.render();
    };
  }

  mount() {
    this.chapterSelect.addEventListener("change", this.handleChapter);
    this.labelToggle.addEventListener("click", this.handleLabels);
    this.editToggle.addEventListener("click", this.handleEditToggle);
    this.stage.addEventListener("pointerdown", this.handlePointerDown);
    this.stage.addEventListener("pointermove", this.handlePointerMove);
    this.stage.addEventListener("pointerup", this.handlePointerUp);
    this.stage.addEventListener("pointercancel", this.handlePointerUp);
    this.stage.addEventListener("wheel", this.handleWheel, { passive: false });
    this.stage.addEventListener("click", this.handleClick);
    this.stage.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
  }

  update(data, selectedQuestId, { editing = this.editing, snapGrid = this.snapGrid, saving = false } = {}) {
    this.data = data;
    this.selectedQuestId = selectedQuestId;
    this.editing = editing;
    this.snapGrid = snapGrid;
    this.editToggle.setAttribute("aria-pressed", String(editing));
    this.editToggle.textContent = editing ? "退出编辑" : "编辑布局";
    this.stage.classList.toggle("editing-layout", editing);
    this.saving = saving;
    this.editToggle.disabled = !data.editing?.enabled || saving;
    const selected = this.findQuest(selectedQuestId);
    if (!this.chapterId || !data.chapters.some(chapter => chapter.id === this.chapterId)) {
      this.chapterId = selected?.chapter.id ?? data.chapters[0]?.id ?? "";
    }
    const chapterOptionsKey = JSON.stringify(data.chapters.map(({ id, title }) => [id, title]));
    if (this.chapterSelect.dataset.chapterOptions !== chapterOptionsKey) {
      this.chapterSelect.replaceChildren(...data.chapters.map(chapter => {
        const option = document.createElement("option");
        option.value = chapter.id;
        option.textContent = chapter.title;
        return option;
      }));
      this.chapterSelect.dataset.chapterOptions = chapterOptionsKey;
    }
    this.chapterSelect.value = this.chapterId;
    this.renderCrossChapterDependencies();
    this.render();
  }

  findQuest(id) {
    for (const chapter of this.data?.chapters ?? []) {
      const quest = chapter.quests.find(candidate => candidate.id === id);
      if (quest) return { chapter, quest };
    }
    return null;
  }

  currentChapter() {
    return this.data?.chapters.find(chapter => chapter.id === this.chapterId) ?? null;
  }

  resolveShape(quest, chapter) {
    const shape = quest.shape || chapter.defaultQuestShape || this.data.defaultQuestShape || "circle";
    return { id: shape, drawable: KNOWN_SHAPES.has(shape) ? shape : "circle", fallback: !KNOWN_SHAPES.has(shape) };
  }

  resolveSize(quest, chapter) {
    return Number(quest.size ?? chapter.defaultQuestSize ?? 1);
  }

  renderCrossChapterDependencies() {
    const chapter = this.currentChapter();
    if (!chapter) {
      this.crossDeps.replaceChildren();
      return;
    }
    const entries = [];
    for (const quest of chapter.quests) {
      for (const id of quest.dependencies ?? []) {
        const dependency = this.findQuest(id);
        if (dependency && dependency.chapter.id !== chapter.id) entries.push({ target: quest, dependency });
      }
    }
    this.crossDeps.replaceChildren();
    if (!entries.length) return;
    const label = document.createElement("span");
    label.textContent = `跨章节依赖 ${entries.length}：`;
    this.crossDeps.append(label);
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = `${entry.dependency.quest.title}（${entry.dependency.chapter.title}）→ ${entry.target.title}`;
      button.textContent = `${entry.dependency.quest.title} → ${entry.target.title}`;
      button.addEventListener("click", () => {
        this.chapterId = entry.dependency.chapter.id;
        this.chapterSelect.value = this.chapterId;
        this.transform = null;
        this.renderCrossChapterDependencies();
        this.render();
      }, { once: true });
      this.crossDeps.append(button);
    }
  }

  positions(chapter) {
    const quests = chapter.quests.filter(quest => Number.isFinite(quest.x) && Number.isFinite(quest.y));
    return quests.map(quest => {
      const size = this.resolveSize(quest, chapter);
      return { quest, size, radius: Math.max(15, Math.min(38, 17 * size)) };
    });
  }

  fitTransform(chapter, width, height) {
    const nodes = this.positions(chapter);
    if (!nodes.length) return null;
    const bounds = nodes.reduce((result, node) => ({
      minX: Math.min(result.minX, node.quest.x - node.radius / 32),
      maxX: Math.max(result.maxX, node.quest.x + node.radius / 32),
      minY: Math.min(result.minY, node.quest.y - node.radius / 32),
      maxY: Math.max(result.maxY, node.quest.y + node.radius / 32),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const unitScale = Math.max(20, Math.min(96, Math.min((width - 116) / rangeX, (height - 112) / rangeY)));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return { unitScale, panX: width / 2 - centerX * unitScale, panY: height / 2 - centerY * unitScale };
  }

  screenPosition(quest, transform) {
    return { x: transform.panX + quest.x * transform.unitScale, y: transform.panY + quest.y * transform.unitScale };
  }

  relatedIds(quest) {
    const ids = new Set([quest.id, ...(quest.dependencies ?? [])]);
    for (const candidate of this.currentChapter()?.quests ?? []) {
      if ((candidate.dependencies ?? []).includes(quest.id)) ids.add(candidate.id);
    }
    return ids;
  }

  setCanvasSize() {
    const bounds = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  render() {
    if (this.destroyed || !this.data) return;
    const chapter = this.currentChapter();
    const { width, height } = this.setCanvasSize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    if (!chapter) return;
    const nodes = this.positions(chapter);
    this.empty.classList.toggle("hidden", nodes.length > 0);
    if (!nodes.length) {
      this.nodeHitboxes = [];
      return;
    }
    if (!this.transform && width > 1 && height > 1) this.transform = this.fitTransform(chapter, width, height);
    if (!this.transform) return;
    this.transform.unitScale *= this.zoom / (this.transform.zoom ?? 1);
    this.transform.zoom = this.zoom;
    this.zoomValue.textContent = `${Math.round(this.zoom * 100)}%`;
    const byId = new Map(nodes.map(node => [node.quest.id, node]));
    const selected = chapter.quests.find(quest => quest.id === this.selectedQuestId);
    const related = selected ? this.relatedIds(selected) : new Set();
    this.nodeHitboxes = [];

    for (const node of nodes) {
      for (const dependencyId of node.quest.dependencies ?? []) {
        const dependency = byId.get(dependencyId);
        if (!dependency) continue;
        const from = this.screenPosition(dependency.quest, this.transform);
        const to = this.screenPosition(node.quest, this.transform);
        const highlighted = related.has(node.quest.id) && related.has(dependency.quest.id);
        this.drawDependency(from, to, highlighted);
      }
    }
    for (const node of nodes) this.drawNode(node, chapter, related, width, height);
    const accessibleNode = this.nodeHitboxes.find(hit => hit.quest.id === this.hoveredQuestId)
      ?? this.nodeHitboxes.find(hit => hit.quest.id === this.selectedQuestId);
    if (accessibleNode) {
      this.canvas.title = accessibleNode.tooltip;
      this.canvas.setAttribute("aria-label", `当前任务节点：${accessibleNode.quest.title}。方向键切换节点，回车打开任务详情。`);
    }
    const missingCount = chapter.quests.length - nodes.length;
    const label = this.editing
      ? `编辑布局：拖动节点移动 · 拖动空白平移 · 坐标支持 0.5 间隔${missingCount ? ` · ${missingCount} 个无坐标任务可在右侧选中后填写坐标` : ""}`
      : missingCount
        ? `${missingCount} 个缺少坐标的任务未显示；点「编辑布局」可补坐标`
        : `${chapter.quests.length} 个任务 · 静态预览；点「编辑布局」可拖动节点`;
    const hint = document.querySelector("#graphHint");
    if (hint) hint.textContent = label;
  }

  drawDependency(from, to, highlighted) {
    const ctx = this.ctx;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const startX = from.x + Math.cos(angle) * 18;
    const startY = from.y + Math.sin(angle) * 18;
    const endX = to.x - Math.cos(angle) * 22;
    const endY = to.y - Math.sin(angle) * 22;
    ctx.save();
    ctx.strokeStyle = highlighted ? "#e1bd68" : "#65706a";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = highlighted ? 2 : 1.25;
    ctx.setLineDash(highlighted ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle - .55) * 7, endY - Math.sin(angle - .55) * 7);
    ctx.lineTo(endX - Math.cos(angle + .55) * 7, endY - Math.sin(angle + .55) * 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  shapePath(ctx, shape, x, y, radius) {
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    } else if (shape === "square") {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else if (shape === "hexagon") {
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 3 * index - Math.PI / 6;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      for (let index = 0; index < 32; index += 1) {
        const angle = Math.PI * 2 * index / 32 - Math.PI / 2;
        const r = index % 4 < 2 ? radius : radius * .76;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }

  drawNode(node, chapter, related, width, height) {
    const ctx = this.ctx;
    const position = this.screenPosition(node.quest, this.transform);
    const { x, y } = position;
    const size = Math.max(15, Math.min(38, node.radius * Math.min(1.35, this.transform.unitScale / 36)));
    const { drawable, id: shapeId, fallback } = this.resolveShape(node.quest, chapter);
    const isSelected = node.quest.id === this.selectedQuestId;
    const isRelated = related.has(node.quest.id);
    const inside = x + size + 90 >= 0 && x - size - 90 <= width && y + size + 32 >= 0 && y - size - 32 <= height;
    if (!inside) return;
    this.shapePath(ctx, drawable, x, y, size + (isSelected ? 5 : 0));
    ctx.fillStyle = isSelected ? "#66502a" : isRelated ? "#383427" : "#292e2d";
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#f0d28b" : isRelated ? "#d1ac5c" : "#8a754a";
    ctx.lineWidth = isSelected ? 2.5 : isRelated ? 2 : 1.25;
    ctx.stroke();
    const inset = Math.max(2, size * .18);
    this.shapePath(ctx, drawable, x, y, size - inset);
    ctx.save();
    ctx.clip();
    const icon = node.quest.icon ? this.getAsset(node.quest.icon) : null;
    if (icon?.complete && icon.naturalWidth) {
      const iconSize = Math.min(size * 1.1, 32);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(icon, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
    } else {
      ctx.fillStyle = "#e1bd68";
      ctx.font = "bold 11px 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.quest.title.slice(0, 1), x, y);
    }
    ctx.restore();
    const tooltip = `${node.quest.title}\n坐标 (${node.quest.x}, ${node.quest.y})\n形状 ${shapeId}${fallback ? "（未知，圆形回退）" : ""} · 尺寸 ${node.size}\n依赖 ${node.quest.dependencies?.length ?? 0} 项`;
    this.nodeHitboxes.push({ x, y, radius: size + 5, quest: node.quest, tooltip });
    if (!this.showLabels && node.quest.id !== this.selectedQuestId && node.quest.id !== this.hoveredQuestId) return;
    const text = node.quest.title;
    ctx.font = "11px 'Microsoft YaHei UI', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const textWidth = Math.min(172, Math.max(size * 2.4, ctx.measureText(text).width + 14));
    ctx.fillStyle = "#1b1e1d";
    ctx.fillRect(x - textWidth / 2, y + size + 7, textWidth, 21);
    ctx.strokeStyle = isSelected ? "#947336" : "#424945";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - textWidth / 2 + .5, y + size + 7.5, textWidth - 1, 20);
    ctx.fillStyle = isSelected ? "#f4dfa9" : isRelated ? "#ded3b5" : "#c3cbc4";
    ctx.fillText(text, x, y + size + 11, textWidth - 10);
  }

  pointerDown(event) {
    if (event.button !== 0 || this.saving) return;
    const bounds = this.stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const node = this.editing && [...this.nodeHitboxes].reverse().find(hit => Math.hypot(hit.x - x, hit.y - y) <= hit.radius);
    this.drag = node
      ? { pointerId: event.pointerId, mode: "node", node: node.quest, startX: event.clientX, startY: event.clientY, x: node.quest.x, y: node.quest.y, moved: false }
      : { pointerId: event.pointerId, mode: "pan", startX: event.clientX, startY: event.clientY, panX: this.transform?.panX ?? 0, panY: this.transform?.panY ?? 0, moved: false };
    this.stage.setPointerCapture(event.pointerId);
    this.stage.classList.add("dragging");
  }

  pointerMove(event) {
    if (!this.drag) {
      const bounds = this.stage.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const node = [...this.nodeHitboxes].reverse().find(hit => Math.hypot(hit.x - x, hit.y - y) <= hit.radius);
      const nextId = node?.quest.id ?? "";
      if (nextId !== this.hoveredQuestId) {
        this.hoveredQuestId = nextId;
        if (node) this.canvas.title = node.tooltip;
        else this.canvas.removeAttribute("title");
        this.render();
      }
      return;
    }
    if (this.drag.pointerId !== event.pointerId || !this.transform || this.saving) return;
    const dx = event.clientX - this.drag.startX;
    const dy = event.clientY - this.drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
    if (this.drag.mode === "node") {
      let nextX = this.drag.x + dx / this.transform.unitScale;
      let nextY = this.drag.y + dy / this.transform.unitScale;
      if (this.snapGrid) {
        nextX = Math.round(nextX * 2) / 2;
        nextY = Math.round(nextY * 2) / 2;
      }
      this.onMoveQuest(this.drag.node.id, nextX, nextY);
    } else {
      this.transform.panX = this.drag.panX + dx;
      this.transform.panY = this.drag.panY + dy;
    }
    this.render();
  }

  pointerUp(event) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.suppressClick = this.drag.moved;
    if (this.suppressClick) window.setTimeout(() => { this.suppressClick = false; }, 0);
    this.stage.releasePointerCapture(event.pointerId);
    this.drag = null;
    this.stage.classList.remove("dragging");
  }

  wheel(event) {
    event.preventDefault();
    const bounds = this.stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    this.zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, x, y);
  }

  zoomAt(multiplier, x, y) {
    if (!this.transform) return;
    const old = this.transform.unitScale;
    const next = Math.max(0.35, Math.min(3.5, this.zoom * multiplier));
    const ratio = next / this.zoom;
    this.transform.panX = x - (x - this.transform.panX) * ratio;
    this.transform.panY = y - (y - this.transform.panY) * ratio;
    this.transform.unitScale = old * ratio;
    this.zoom = next;
    this.transform.zoom = next;
    this.render();
  }

  click(event) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const bounds = this.stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const node = [...this.nodeHitboxes].reverse().find(hit => Math.hypot(hit.x - x, hit.y - y) <= hit.radius);
    if (node) {
      this.selectedQuestId = node.quest.id;
      this.canvas.focus({ preventScroll: true });
      this.render();
      this.onOpenQuest(node.quest.id);
    }
  }

  keyDown(event) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Enter"].includes(event.key)) return;
    const quests = this.positions(this.currentChapter()).map(node => node.quest);
    if (!quests.length) return;
    const current = Math.max(0, quests.findIndex(quest => quest.id === this.selectedQuestId));
    if (event.key === "Enter") {
      event.preventDefault();
      this.onOpenQuest(quests[current].id);
      return;
    }
    event.preventDefault();
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = (current + direction + quests.length) % quests.length;
    this.selectedQuestId = quests[next].id;
    this.render();
  }

  zoomBy(multiplier) {
    const rect = this.stage.getBoundingClientRect();
    this.zoomAt(multiplier, rect.width / 2, rect.height / 2);
  }

  fit() {
    this.zoom = 1;
    this.transform = null;
    this.render();
  }

  destroy() {
    this.destroyed = true;
    this.chapterSelect.removeEventListener("change", this.handleChapter);
    this.labelToggle.removeEventListener("click", this.handleLabels);
    this.editToggle.removeEventListener("click", this.handleEditToggle);
    this.stage.removeEventListener("pointerdown", this.handlePointerDown);
    this.stage.removeEventListener("pointermove", this.handlePointerMove);
    this.stage.removeEventListener("pointerup", this.handlePointerUp);
    this.stage.removeEventListener("pointercancel", this.handlePointerUp);
    this.stage.removeEventListener("wheel", this.handleWheel);
    this.stage.removeEventListener("click", this.handleClick);
    this.stage.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.handleResize);
    this.nodeHitboxes = [];
    this.data = null;
  }
}

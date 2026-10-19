import { splitPages, tokenizeFormatting } from "../lib/minecraft-text.js";

export class QuestDetails {
  constructor({ canvas, scroll, stage, canvasSize, getAsset, textRenderer, onPageInfo }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.scroll = scroll;
    this.stage = stage;
    this.canvasSize = canvasSize;
    this.getAsset = getAsset;
    this.textRenderer = textRenderer;
    this.onPageInfo = onPageInfo;
    this.snapshot = null;
    this.handleResize = () => this.draw();
    this.handleScroll = () => this.draw();
  }

  mount() {
    window.addEventListener("resize", this.handleResize);
    this.scroll.addEventListener("scroll", this.handleScroll, { passive: true });
    this.getAsset("minecraft:font/ascii", image => this.textRenderer.setAtlas(image));
    this.getAsset("ftblibrary:textures/gui/background_squares");
  }

  update(snapshot) {
    this.snapshot = snapshot;
    this.draw();
  }

  drawTaskColumns(quest, left, top, width) {
    const tasks = quest.tasks ?? [];
    const rewards = quest.rewards ?? [];
    const gap = 8;
    const columnWidth = (width - gap) / 2;
    const rowCount = Math.max(1, tasks.length, rewards.length);
    const columns = [
      { x: left, label: "目标", rows: tasks, heading: "#5555ff", kind: "task" },
      { x: left + columnWidth + gap, label: "奖励", rows: rewards, heading: "#ffaa00", kind: "reward" },
    ];
    for (const column of columns) {
      const ctx = this.context;
      ctx.fillStyle = column.heading;
      ctx.font = "9px 'Minecraft UI', 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(column.label, column.x, top + 8);
      if (!column.rows.length) {
        ctx.fillStyle = "#b7bcb6";
        ctx.fillText(column.kind === "reward" ? "没有奖励" : "无目标", column.x, top + 24, columnWidth);
        continue;
      }
      for (const [index, row] of column.rows.entries()) {
        const y = top + 15 + index * 19;
        const value = row.item ?? row.icon ?? row;
        const itemId = typeof value === "object" ? value.id ?? "" : String(value);
        const icon = row.type === "checkmark" || !itemId ? null : this.getAsset(itemId);
        const ready = icon?.complete && icon.naturalWidth > 0;
        if (ready) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(icon, column.x, y, 16, 16);
        } else {
          ctx.fillStyle = "#414642";
          ctx.fillRect(column.x, y, 16, 16);
          ctx.strokeStyle = "#69726a";
          ctx.strokeRect(column.x + .5, y + .5, 15, 15);
          ctx.fillStyle = row.type === "checkmark" ? "#9cc18b" : "#d7c486";
          ctx.fillText(row.type === "checkmark" ? "✓" : "物", column.x + 3, y + 11);
        }
        ctx.fillStyle = "#b7bcb6";
        const label = row.type === "checkmark" ? "手动确认" : (() => {
          const count = Number(row.count ?? (typeof value === "object" ? value.count : undefined) ?? 1);
          return count > 1 ? `物品 ×${count}` : "物品";
        })();
        ctx.fillText(label, column.x + 20, y + 10, Math.max(20, columnWidth - 21));
      }
    }
    return top + 15 + rowCount * 19 + 4;
  }

  draw() {
    const snapshot = this.snapshot;
    const selected = snapshot?.selected;
    if (!selected) return;
    const ctx = this.context;
    const pages = splitPages(snapshot.draft);
    const page = Math.min(snapshot.page, Math.max(0, pages.length - 1));
    this.onPageInfo(page, pages.length);
    const width = snapshot.logicalWidth;
    const padding = 16;
    const innerWidth = width - padding * 2;
    const elements = this.textRenderer.elements(pages[page], innerWidth);
    const tasks = selected.quest.tasks ?? [];
    const rewards = selected.quest.rewards ?? [];
    const taskHeight = tasks.length || rewards.length ? 15 + Math.max(1, tasks.length, rewards.length) * 19 + 4 : 0;
    let contentHeight = 0;
    for (const item of elements) contentHeight += item.type === "space" ? item.height : item.type === "image" ? item.height + 7 : item.lines.length * 9 + 9;
    const hasSubtitle = Boolean(selected.quest.subtitle);
    const panelHeight = Math.max(132, 55 + taskHeight + (taskHeight ? 5 : 0) + contentHeight + 16 + (hasSubtitle ? 12 : 0));
    const scale = snapshot.guiScale;
    const stageWidth = this.scroll.clientWidth;
    const stageHeight = this.scroll.clientHeight;
    const cssWidth = Math.max(stageWidth, Math.ceil((width + 64) * scale));
    const cssHeight = Math.max(stageHeight, Math.ceil((panelHeight + 64) * scale));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.ceil(cssWidth * dpr);
    this.canvas.height = Math.ceil(cssHeight * dpr);
    this.stage.style.width = `${cssWidth}px`;
    this.stage.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const panelX = Math.max(32, (cssWidth / scale - width) / 2);
    const panelY = Math.max(32, (cssHeight / scale - panelHeight) / 2);
    ctx.fillStyle = "#1b1d1e";
    ctx.fillRect(panelX - 1, panelY - 1, width + 2, panelHeight + 2);
    ctx.fillStyle = "#252a29";
    ctx.fillRect(panelX, panelY, width, panelHeight);
    const background = this.getAsset("ftblibrary:textures/gui/background_squares");
    if (background?.complete && background.naturalWidth) {
      const pattern = ctx.createPattern(background, "repeat");
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.globalAlpha = .22;
        ctx.fillRect(panelX + 1, panelY + 1, width - 2, panelHeight - 2);
        ctx.globalAlpha = 1;
      }
    }
    const questIcon = selected.quest.icon ? this.getAsset(selected.quest.icon) : null;
    if (questIcon?.complete && questIcon.naturalWidth) ctx.drawImage(questIcon, panelX + 5, panelY + 5, 16, 16);
    ctx.fillStyle = "#aaaaaa";
    ctx.font = "bold 10px 'Minecraft UI', 'Microsoft YaHei UI', sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(selected.quest.title, panelX + (questIcon ? 27 : 9), panelY + 14, width - (questIcon ? 35 : 18));
    if (hasSubtitle) {
      ctx.fillStyle = "#b8b8b8";
      ctx.font = "9px 'Minecraft UI', 'Microsoft YaHei UI', sans-serif";
      ctx.fillText(selected.quest.subtitle, panelX + 9, panelY + 29, width - 18);
    }
    const titleBottom = panelY + (hasSubtitle ? 36 : 25);
    ctx.fillStyle = "#1b1d1e";
    ctx.fillRect(panelX + 1, titleBottom, width - 2, 1);
    let y = titleBottom + 7;
    if (taskHeight) y = this.drawTaskColumns(selected.quest, panelX + padding, y, innerWidth);
    const textLeft = panelX + padding;
    for (const item of elements) {
      if (item.type === "space") y += item.height;
      else if (item.type === "image") {
        const image = this.getAsset(item.source);
        const imageWidth = Math.min(item.width, innerWidth);
        const imageHeight = item.width > innerWidth ? Math.round(item.height * (innerWidth / item.width)) : item.height;
        let x = textLeft;
        if (item.align === "center") x = textLeft + (innerWidth - imageWidth) / 2;
        if (item.align === "right") x = textLeft + innerWidth - imageWidth;
        if (image?.complete && image.naturalWidth) ctx.drawImage(image, x, y, imageWidth, imageHeight);
        else {
          ctx.fillStyle = "#3b403e";
          ctx.fillRect(x, y, imageWidth, imageHeight);
          ctx.strokeStyle = "#68706b";
          ctx.strokeRect(x + .5, y + .5, imageWidth - 1, imageHeight - 1);
          ctx.fillStyle = "#d1b775";
          ctx.font = "8px monospace";
          ctx.fillText(`圖片未找到：${item.source}`, x + 7, y + 15, imageWidth - 12);
        }
        y += imageHeight + 7;
      } else {
        for (const line of item.lines) {
          this.textRenderer.drawTokens(ctx, line, textLeft, y);
          y += 9;
        }
        y += 9;
      }
    }
    if (pages.length > 1) {
      const buttonY = panelY + panelHeight - 19;
      ctx.fillStyle = "#d5d5d5";
      ctx.font = "9px 'Minecraft UI', sans-serif";
      if (page > 0) ctx.fillText("‹ 上一页", panelX + 9, buttonY);
      if (page < pages.length - 1) ctx.fillText("下一页 ›", panelX + width - 61, buttonY);
    }
    this.canvasSize.textContent = `${width} × ${Math.round(panelHeight)} logical px · ${scale}×`;
  }

  showError(message) {
    const ctx = this.context;
    this.canvas.width = 640;
    this.canvas.height = 160;
    this.canvas.style.width = "640px";
    this.canvas.style.height = "160px";
    ctx.fillStyle = "#211d1b";
    ctx.fillRect(0, 0, 640, 160);
    ctx.fillStyle = "#ef9878";
    ctx.font = "14px sans-serif";
    ctx.fillText("任务文件读取失败", 24, 42);
    ctx.fillStyle = "#bca69b";
    ctx.font = "11px monospace";
    ctx.fillText(message.slice(0, 90), 24, 70);
  }

  destroy() {
    window.removeEventListener("resize", this.handleResize);
    this.scroll.removeEventListener("scroll", this.handleScroll);
    this.snapshot = null;
  }
}

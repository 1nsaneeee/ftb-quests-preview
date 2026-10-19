export class QuestEditor {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.handleTitle = () => handlers.change({ title: this.title.value });
    this.handleSubtitle = () => handlers.change({ subtitle: this.subtitle.value });
    this.handleX = () => { if (Number.isFinite(this.x.valueAsNumber)) handlers.change({ x: this.x.valueAsNumber }); };
    this.handleY = () => { if (Number.isFinite(this.y.valueAsNumber)) handlers.change({ y: this.y.valueAsNumber }); };
    this.handleSnap = () => handlers.snap(this.snap.checked);
    this.handleSave = () => handlers.save();
    this.handleDiscard = () => handlers.discard();
  }

  mount() {
    this.root.hidden = true;
    this.root.innerHTML = `
      <section class="quest-editor" aria-labelledby="editorTitle">
        <div class="editor-heading">
          <div>
            <div class="section-kicker">QUEST EDITOR</div>
            <h3 id="editorTitle">编辑当前任务</h3>
          </div>
          <output class="editor-change-count" aria-live="polite"></output>
        </div>
        <div class="editor-fields">
          <label class="editor-field" for="editorTitleInput">标题
            <input id="editorTitleInput" type="text" autocomplete="off" />
          </label>
          <label class="editor-field" for="editorSubtitleInput">副标题
            <input id="editorSubtitleInput" type="text" autocomplete="off" />
          </label>
          <div class="editor-coordinates" role="group" aria-label="任务节点坐标">
            <label class="editor-field" for="editorX">X
              <input id="editorX" type="number" step="0.5" />
            </label>
            <label class="editor-field" for="editorY">Y
              <input id="editorY" type="number" step="0.5" />
            </label>
          </div>
        </div>
        <label class="editor-snap"><input id="editorSnap" type="checkbox" checked /> 拖动时吸附到 0.5 网格</label>
        <p class="editor-hint">拖拽节点需先在「章节任务图」开启「编辑布局」；也可以直接填写 X / Y。</p>
        <p class="editor-message" role="status" aria-live="polite"></p>
        <div class="editor-actions">
          <button class="editor-save" type="button">保存更改</button>
          <button class="editor-discard" type="button">放弃更改 / 重新载入</button>
        </div>
      </section>`;
    this.title = this.root.querySelector("#editorTitleInput");
    this.subtitle = this.root.querySelector("#editorSubtitleInput");
    this.x = this.root.querySelector("#editorX");
    this.y = this.root.querySelector("#editorY");
    this.snap = this.root.querySelector("#editorSnap");
    this.changeCount = this.root.querySelector(".editor-change-count");
    this.message = this.root.querySelector(".editor-message");
    this.saveButton = this.root.querySelector(".editor-save");
    this.discardButton = this.root.querySelector(".editor-discard");
    this.title.addEventListener("input", this.handleTitle);
    this.subtitle.addEventListener("input", this.handleSubtitle);
    this.x.addEventListener("change", this.handleX);
    this.y.addEventListener("change", this.handleY);
    this.snap.addEventListener("change", this.handleSnap);
    this.saveButton.addEventListener("click", this.handleSave);
    this.discardButton.addEventListener("click", this.handleDiscard);
  }

  update(snapshot) {
    const { selected, enabled, editing, snapGrid, changedCount, saving, message, error, saveConflict } = snapshot;
    this.root.hidden = !editing;
    this.title.disabled = !enabled || !selected || saving;
    this.subtitle.disabled = !enabled || !selected || saving;
    this.x.disabled = !enabled || !selected || saving;
    this.y.disabled = !enabled || !selected || saving;
    this.snap.disabled = !editing || saving;
    this.saveButton.disabled = !enabled || saving || saveConflict || changedCount === 0;
    this.discardButton.disabled = saving;
    this.saveButton.textContent = saving ? "保存中…" : "保存更改";
    this.changeCount.textContent = `待保存 ${changedCount} 处`;
    this.message.textContent = message ?? "";
    this.message.classList.toggle("error", Boolean(error));
    this.snap.checked = snapGrid;
    if (!selected) return;
    if (document.activeElement !== this.title) this.title.value = selected.quest.title;
    if (document.activeElement !== this.subtitle) this.subtitle.value = selected.quest.subtitle ?? "";
    if (document.activeElement !== this.x) this.x.value = Number.isFinite(selected.quest.x) ? String(selected.quest.x) : "";
    if (document.activeElement !== this.y) this.y.value = Number.isFinite(selected.quest.y) ? String(selected.quest.y) : "";
  }

  destroy() {
    this.title.removeEventListener("input", this.handleTitle);
    this.subtitle.removeEventListener("input", this.handleSubtitle);
    this.x.removeEventListener("change", this.handleX);
    this.y.removeEventListener("change", this.handleY);
    this.snap.removeEventListener("change", this.handleSnap);
    this.saveButton.removeEventListener("click", this.handleSave);
    this.discardButton.removeEventListener("click", this.handleDiscard);
    this.root.replaceChildren();
  }
}

export class PreviewControls {
  constructor(elements, handlers) {
    this.elements = elements;
    this.handlers = handlers;
    this.onLocale = () => handlers.locale(elements.locale.value);
    this.onWidth = () => handlers.width(Number(elements.panelWidth.value));
    this.onScale = () => handlers.scale(Number(elements.guiScale.value));
    this.onPrevious = () => handlers.page(-1);
    this.onNext = () => handlers.page(1);
    this.onDraft = () => handlers.draft(elements.draft.value);
    this.onReset = () => handlers.resetDraft();
  }

  mount() {
    const el = this.elements;
    el.locale.addEventListener("change", this.onLocale);
    el.panelWidth.addEventListener("input", this.onWidth);
    el.guiScale.addEventListener("input", this.onScale);
    el.prevPage.addEventListener("click", this.onPrevious);
    el.nextPage.addEventListener("click", this.onNext);
    el.draft.addEventListener("input", this.onDraft);
    el.resetDraft.addEventListener("click", this.onReset);
  }

  update(snapshot) {
    const el = this.elements;
    if (el.locale.dataset.optionsKey !== snapshot.supportedLocales.join("|")) {
      el.locale.replaceChildren(...snapshot.supportedLocales.map(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        return option;
      }));
      el.locale.dataset.optionsKey = snapshot.supportedLocales.join("|");
    }
    el.locale.value = snapshot.locale;
    el.panelWidth.min = String(Math.max(180, snapshot.minWidth || 180));
    el.panelWidth.value = String(snapshot.logicalWidth);
    el.widthValue.textContent = `${snapshot.logicalWidth} px`;
    el.guiScale.value = String(snapshot.guiScale);
    el.scaleValue.textContent = `${snapshot.guiScale}×`;
    el.pageValue.textContent = `${snapshot.page + 1} / ${snapshot.pageCount}`;
    el.prevPage.disabled = snapshot.page <= 0;
    el.nextPage.disabled = snapshot.page >= snapshot.pageCount - 1;
    if (el.draft.value !== snapshot.draft) el.draft.value = snapshot.draft;
  }

  destroy() {
    const el = this.elements;
    el.locale.removeEventListener("change", this.onLocale);
    el.panelWidth.removeEventListener("input", this.onWidth);
    el.guiScale.removeEventListener("input", this.onScale);
    el.prevPage.removeEventListener("click", this.onPrevious);
    el.nextPage.removeEventListener("click", this.onNext);
    el.draft.removeEventListener("input", this.onDraft);
    el.resetDraft.removeEventListener("click", this.onReset);
  }
}

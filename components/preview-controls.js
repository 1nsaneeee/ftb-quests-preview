const WIDTH_STEP = 4;
const DEFAULT_MIN_WIDTH = 180;
const DEFAULT_MAX_WIDTH = 640;

export function widthBoundsFor(minWidth) {
  const min = Math.max(DEFAULT_MIN_WIDTH, Number.isFinite(minWidth) ? minWidth : DEFAULT_MIN_WIDTH);
  const max = min > DEFAULT_MAX_WIDTH ? min : min + Math.floor((DEFAULT_MAX_WIDTH - min) / WIDTH_STEP) * WIDTH_STEP;
  return { min, max };
}

export function normalizeWidth(value, bounds) {
  const clamped = Math.min(bounds.max, Math.max(bounds.min, Number(value)));
  const snapped = bounds.min + Math.round((clamped - bounds.min) / WIDTH_STEP) * WIDTH_STEP;
  return Math.min(bounds.max, Math.max(bounds.min, snapped));
}

export class PreviewControls {
  constructor(elements, handlers) {
    this.elements = elements;
    this.handlers = handlers;
    this.widthBounds = { min: DEFAULT_MIN_WIDTH, max: DEFAULT_MAX_WIDTH };
    this.onLocale = () => handlers.locale(elements.locale.value);
    this.onRangeWidth = () => this.commitWidth(elements.panelWidth.value);
    this.onNumberChange = () => this.commitWidth(elements.panelWidthNumber.value);
    this.onNumberBlur = () => {
      const value = elements.panelWidthNumber.value;
      if (this.isValidNumber(value)) this.commitWidth(value);
      else this.showWidth(this.lastWidth);
    };
    this.onScale = event => {
      const button = event.target.closest("[data-scale]");
      if (button) handlers.scale(Number(button.dataset.scale));
    };
    this.onPrevious = () => handlers.page(-1);
    this.onNext = () => handlers.page(1);
    this.onReset = () => handlers.resetDraft();
  }

  mount() {
    const el = this.elements;
    el.locale.addEventListener("change", this.onLocale);
    el.panelWidth.addEventListener("input", this.onRangeWidth);
    el.panelWidthNumber.addEventListener("change", this.onNumberChange);
    el.panelWidthNumber.addEventListener("blur", this.onNumberBlur);
    el.scaleGroup.addEventListener("click", this.onScale);
    el.prevPage.addEventListener("click", this.onPrevious);
    el.nextPage.addEventListener("click", this.onNext);
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
    const { min, max } = widthBoundsFor(snapshot.minWidth);
    this.widthBounds = { min, max };
    for (const input of [el.panelWidth, el.panelWidthNumber]) {
      input.min = String(min);
      input.max = String(max);
      input.step = String(WIDTH_STEP);
    }
    el.widthEnds.textContent = `${min}–${max} px`;
    this.lastWidth = snapshot.logicalWidth;
    this.showWidth(snapshot.logicalWidth);

    for (const button of el.scaleButtons) {
      const selected = Number(button.dataset.scale) === snapshot.guiScale;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("selected", selected);
    }
    el.pageValue.textContent = `${snapshot.page + 1} / ${snapshot.pageCount}`;
    el.prevPage.disabled = snapshot.page <= 0;
    el.nextPage.disabled = snapshot.page >= snapshot.pageCount - 1;
  }

  isValidNumber(value) {
    return String(value).trim() !== "" && Number.isFinite(Number(value));
  }

  normalizeWidth(value) {
    return normalizeWidth(value, this.widthBounds);
  }

  commitWidth(value) {
    if (!this.isValidNumber(value)) return;
    const width = this.normalizeWidth(value);
    this.lastWidth = width;
    this.showWidth(width);
    this.handlers.width(width);
  }

  showWidth(width) {
    const el = this.elements;
    el.panelWidth.value = String(width);
    el.panelWidthNumber.value = String(width);
    const { min, max } = this.widthBounds;
    const progress = max > min ? ((width - min) / (max - min)) * 100 : 100;
    el.panelWidth.style.setProperty("--range-progress", `${progress}%`);
  }

  destroy() {
    const el = this.elements;
    el.locale.removeEventListener("change", this.onLocale);
    el.panelWidth.removeEventListener("input", this.onRangeWidth);
    el.panelWidthNumber.removeEventListener("change", this.onNumberChange);
    el.panelWidthNumber.removeEventListener("blur", this.onNumberBlur);
    el.scaleGroup.removeEventListener("click", this.onScale);
    el.prevPage.removeEventListener("click", this.onPrevious);
    el.nextPage.removeEventListener("click", this.onNext);
    el.resetDraft.removeEventListener("click", this.onReset);
  }
}

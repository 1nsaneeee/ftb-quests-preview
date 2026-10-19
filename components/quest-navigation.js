export class QuestNavigation {
  constructor({ root, search, getAsset, onSelect }) {
    this.root = root;
    this.searchInput = search;
    this.getAsset = getAsset;
    this.onSelect = onSelect;
    this.data = null;
    this.selectedQuestId = "";
    this.search = "";
    this.collapsed = new Set();
    this.onSearch = () => {
      this.search = this.searchInput.value;
      this.render();
    };
    this.onClick = event => {
      const chapter = event.target.closest("[data-chapter-toggle]");
      if (chapter) {
        const id = chapter.dataset.chapterToggle;
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        this.render();
        return;
      }
      const quest = event.target.closest("[data-quest-id]");
      if (quest) this.onSelect(quest.dataset.questId);
    };
  }

  mount() {
    this.searchInput.addEventListener("input", this.onSearch);
    this.root.addEventListener("click", this.onClick);
  }

  update(data, selectedQuestId) {
    this.data = data;
    this.selectedQuestId = selectedQuestId;
    this.render();
  }

  render() {
    if (!this.data) return;
    this.root.replaceChildren();
    const filter = this.search.trim().toLocaleLowerCase();
    for (const chapter of this.data.chapters) {
      const quests = chapter.quests.filter(quest => `${quest.title} ${quest.id} ${chapter.title}`.toLocaleLowerCase().includes(filter));
      if (filter && !quests.length && !chapter.title.toLocaleLowerCase().includes(filter)) continue;
      const block = document.createElement("section");
      block.className = `chapter-block${this.collapsed.has(chapter.id) && !filter ? " collapsed" : ""}`;
      const heading = document.createElement("button");
      heading.className = "chapter-title";
      heading.type = "button";
      heading.dataset.chapterToggle = chapter.id;
      const chevron = document.createElement("span");
      chevron.className = "chapter-chev";
      chevron.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
      const title = document.createElement("span");
      title.className = "chapter-title-text";
      title.textContent = chapter.title;
      const total = document.createElement("span");
      total.className = "chapter-total";
      total.textContent = String(quests.length).padStart(2, "0");
      heading.append(chevron, title, total);
      const list = document.createElement("div");
      list.className = "quest-list";
      for (const quest of quests) {
        const row = document.createElement("button");
        row.className = `quest-row${quest.id === this.selectedQuestId ? " selected" : ""}`;
        row.type = "button";
        row.dataset.questId = quest.id;
        const icon = document.createElement("span");
        icon.className = "quest-icon";
        icon.textContent = quest.title.slice(0, 1);
        const titleNode = document.createElement("span");
        titleNode.className = "quest-row-title";
        titleNode.textContent = quest.title;
        if (quest.icon) {
          const image = this.getAsset(quest.icon);
          if (image?.complete && image.naturalWidth) {
            const node = new Image();
            node.src = image.src;
            node.alt = "";
            icon.replaceChildren(node);
          } else if (image) {
            image.addEventListener("load", () => {
              if (row.isConnected) {
                const node = new Image();
                node.src = image.src;
                node.alt = "";
                icon.replaceChildren(node);
              }
            }, { once: true });
          }
        }
        row.title = `${quest.title} · ${quest.id}`;
        row.append(icon, titleNode);
        list.append(row);
      }
      block.append(heading, list);
      this.root.append(block);
    }
  }

  destroy() {
    this.searchInput.removeEventListener("input", this.onSearch);
    this.root.removeEventListener("click", this.onClick);
    this.root.replaceChildren();
  }
}

export class QuestNavigation {
  constructor({ root, search, getAsset, onSelect }) {
    this.root = root;
    this.searchInput = search;
    this.getAsset = getAsset;
    this.onSelect = onSelect;
    this.data = null;
    this.selectedQuestId = "";
    this.search = "";
    this.collapsedGroups = new Set();
    this.collapsedChapters = new Set();
    this.instanceId = `quest-tree-${Math.random().toString(36).slice(2)}`;
    this.onSearch = () => {
      this.search = this.searchInput.value;
      this.render();
    };
    this.onClick = event => {
      const group = event.target.closest("[data-group-toggle]");
      if (group) {
        this.toggle(this.collapsedGroups, group.dataset.groupToggle);
        this.render();
        return;
      }
      const chapter = event.target.closest("[data-chapter-toggle]");
      if (chapter) {
        this.toggle(this.collapsedChapters, chapter.dataset.chapterToggle);
        this.render();
        return;
      }
      const quest = event.target.closest("[data-quest-id]");
      if (quest) this.onSelect(quest.dataset.questId);
    };
  }

  toggle(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }

  mount() {
    this.searchInput.addEventListener("input", this.onSearch);
    this.root.addEventListener("click", this.onClick);
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "任务章节与任务");
  }

  update(data, selectedQuestId) {
    this.data = data;
    if (selectedQuestId !== this.selectedQuestId) this.expandSelectedPath(selectedQuestId);
    this.selectedQuestId = selectedQuestId;
    this.render();
  }

  expandSelectedPath(questId) {
    const chapter = this.data?.chapters.find(candidate => candidate.quests.some(quest => quest.id === questId));
    if (!chapter) return;
    this.collapsedChapters.delete(chapter.id);
    const knownGroup = this.data.chapterGroups?.some(group => group.id === chapter.group);
    this.collapsedGroups.delete(knownGroup ? chapter.group : UNASSIGNED_ID);
  }

  groups() {
    const chapters = this.data.chapters;
    const knownGroups = Array.isArray(this.data.chapterGroups) ? this.data.chapterGroups : [];
    const groups = knownGroups.map(group => ({
      id: String(group.id),
      title: String(group.title || group.id),
      chapters: chapters.filter(chapter => chapter.group === group.id),
    }));
    const knownIds = new Set(groups.map(group => group.id));
    const unassigned = chapters.filter(chapter => !chapter.group || !knownIds.has(chapter.group));
    if (unassigned.length || groups.length === 0) {
      groups.push({ id: UNASSIGNED_ID, title: "未分组", chapters: unassigned });
    }
    return groups;
  }

  render() {
    if (!this.data) return;
    const activeElement = this.root.contains(this.root.ownerDocument.activeElement)
      ? this.root.ownerDocument.activeElement
      : null;
    const activeControl = activeElement?.closest("[data-quest-id],[data-group-toggle],[data-chapter-toggle]");
    const focusTarget = activeControl ? {
      questId: activeControl.dataset.questId,
      groupId: activeControl.dataset.groupToggle,
      chapterId: activeControl.dataset.chapterToggle,
    } : null;
    this.root.replaceChildren();
    const filter = this.search.trim().toLocaleLowerCase();
    const searching = Boolean(filter);
    for (const group of this.groups()) {
      const groupMatches = searching && this.matches(`${group.title} ${group.id}`, filter);
      const matchingChapters = group.chapters.map(chapter => ({
        chapter,
        quests: chapter.quests.filter(quest => this.matches(`${quest.title} ${quest.id}`, filter)),
      })).filter(({ chapter, quests }) => !searching || groupMatches || this.matches(`${chapter.title} ${chapter.id}`, filter) || quests.length > 0);
      if (searching && !groupMatches && matchingChapters.length === 0) continue;

      const groupId = `${this.instanceId}-group-${this.key(group.id)}`;
      const groupSection = document.createElement("section");
      groupSection.className = `group-block${this.collapsedGroups.has(group.id) && !searching ? " collapsed" : ""}`;
      const groupHeading = this.toggleButton({
        className: "group-title",
        toggleAttribute: "data-group-toggle",
        id: group.id,
        controlsId: groupId,
        expanded: searching || !this.collapsedGroups.has(group.id),
        title: group.title,
        count: group.chapters.reduce((total, chapter) => total + chapter.quests.length, 0),
        chevronClass: "group-chev",
      });
      const chapterList = document.createElement("div");
      chapterList.className = "chapter-group-list";
      chapterList.id = groupId;
      chapterList.setAttribute("role", "group");

      for (const { chapter, quests } of matchingChapters) {
        const chapterMatches = searching && (groupMatches || this.matches(`${chapter.title} ${chapter.id}`, filter));
        const visibleQuests = searching && chapterMatches ? chapter.quests : quests;
        const chapterId = `${this.instanceId}-chapter-${this.key(chapter.id)}`;
        const chapterBlock = document.createElement("section");
        chapterBlock.className = `chapter-block${this.collapsedChapters.has(chapter.id) && !searching ? " collapsed" : ""}`;
        const chapterHeading = this.toggleButton({
          className: "chapter-title",
          toggleAttribute: "data-chapter-toggle",
          id: chapter.id,
          controlsId: chapterId,
          expanded: searching || !this.collapsedChapters.has(chapter.id),
          title: chapter.title,
          count: visibleQuests.length,
          chevronClass: "chapter-chev",
        });
        const questList = document.createElement("div");
        questList.className = "quest-list";
        questList.id = chapterId;
        questList.setAttribute("role", "group");
        for (const quest of visibleQuests) questList.append(this.questButton(quest));
        chapterBlock.append(chapterHeading, questList);
        chapterList.append(chapterBlock);
      }

      groupSection.append(groupHeading, chapterList);
      this.root.append(groupSection);
    }
    if (focusTarget) {
      const controls = this.root.querySelectorAll("[data-quest-id],[data-group-toggle],[data-chapter-toggle]");
      const target = [...controls].find(button => {
        if (focusTarget.questId !== undefined) return button.dataset.questId === focusTarget.questId;
        if (focusTarget.groupId !== undefined) return button.dataset.groupToggle === focusTarget.groupId;
        return button.dataset.chapterToggle === focusTarget.chapterId;
      });
      target?.focus({ preventScroll: true });
    }
  }

  matches(value, filter) {
    return !filter || String(value ?? "").toLocaleLowerCase().includes(filter);
  }

  key(value) {
    return encodeURIComponent(String(value)).replaceAll("%", "_");
  }

  toggleButton({ className, toggleAttribute, id, controlsId, expanded, title, count, chevronClass }) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.dataset[toggleAttribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = id;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-controls", controlsId);
    const chevron = document.createElement("span");
    chevron.className = chevronClass;
    chevron.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    const titleNode = document.createElement("span");
    titleNode.className = toggleAttribute === "data-group-toggle" ? "group-title-text" : "chapter-title-text";
    titleNode.textContent = title;
    const total = document.createElement("span");
    total.className = toggleAttribute === "data-group-toggle" ? "group-total" : "chapter-total";
    total.textContent = String(count).padStart(2, "0");
    button.append(chevron, titleNode, total);
    return button;
  }

  questButton(quest) {
    const row = document.createElement("button");
    row.className = `quest-row${quest.id === this.selectedQuestId ? " selected" : ""}`;
    row.type = "button";
    row.dataset.questId = quest.id;
    if (quest.id === this.selectedQuestId) row.setAttribute("aria-current", "true");
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
          if (!row.isConnected) return;
          const node = new Image();
          node.src = image.src;
          node.alt = "";
          icon.replaceChildren(node);
        }, { once: true });
      }
    }
    row.title = `${quest.title} · ${quest.id}`;
    row.append(icon, titleNode);
    return row;
  }

  destroy() {
    this.searchInput.removeEventListener("input", this.onSearch);
    this.root.removeEventListener("click", this.onClick);
    this.root.replaceChildren();
  }
}

const UNASSIGNED_ID = "__unassigned__";

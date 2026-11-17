function nonempty(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function questTitle(quest, strings = {}, fallback = {}, { locale = "en_us", gameStrings = {} } = {}) {
  const localized = (kind, id) => nonempty(strings[`${kind}.${id}.title`]) ?? nonempty(fallback[`${kind}.${id}.title`]);
  const translated = localized("quest", quest.id);
  if (translated !== undefined) return { title: translated, titleSource: "locale" };
  if (nonempty(quest.title)) return { title: quest.title, titleSource: "inline" };
  const task = quest.tasks?.[0];
  if (!task) return { title: locale.startsWith("zh") ? "未命名任务" : "Unnamed quest", titleSource: "id" };
  const taskTitle = localized("task", task.id) ?? nonempty(task.title);
  if (taskTitle) return { title: taskTitle, titleSource: "task" };
  const chinese = locale.startsWith("zh");
  const item = task.item;
  const customName = typeof item === "object" && item?.components?.["minecraft:custom_name"];
  if (nonempty(customName)) return { title: customName, titleSource: "task" };
  const id = typeof item === "string" ? item : item?.id;
  if (id) {
    const key = id.replace(":", ".").replaceAll("/", ".");
    const title = nonempty(gameStrings[`item.${key}`]) ?? nonempty(gameStrings[`block.${key}`]);
    return { title: title ?? `${chinese ? "物品" : "Item"} · ${id}`, titleSource: "task" };
  }
  const type = String(task.type ?? "task").replace(/^ftbquests:/, "");
  const known = { checkmark: chinese ? "手动确认" : "Checkmark", xp: chinese ? "经验" : "Experience", advancement: chinese ? "进度" : "Advancement" };
  return { title: Object.hasOwn(known, type) ? known[type] : `${chinese ? "目标" : "Task"} · ${type}`, titleSource: "task" };
}

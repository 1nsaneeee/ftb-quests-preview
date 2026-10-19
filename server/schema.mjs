const field = (name, type, description, extra = {}) => ({ name, type, description, ...extra });

export const QUEST_SHAPES = [
  "circle", "diamond", "gear", "heart", "hexagon", "none",
  "octagon", "pentagon", "rsquare", "square",
];

export const DEPENDENCY_REQUIREMENTS = ["all_completed", "one_completed", "all_started", "one_started"];
export const PROGRESSION_MODES = ["default", "linear", "flexible"];

export const TASK_TYPES = [
  "item", "custom", "xp", "dimension", "stat", "kill", "location", "checkmark",
  "advancement", "observation", "biome", "structure", "gamestage", "fluid",
];

export const REWARD_TYPES = [
  "item", "choice", "all_table", "random", "loot", "command", "custom",
  "xp", "xp_levels", "advancement", "toast", "gamestage", "currency",
];

export const QUEST_FIELDS = [
  field("x", "number", "节点 X 坐标；写入 chapter SNBT。"),
  field("y", "number", "节点 Y 坐标；写入 chapter SNBT。"),
  field("shape", "string", "节点形状；空字符串表示使用章节/文件默认值。", { enum: ["", ...QUEST_SHAPES] }),
  field("size", "number", "节点尺寸倍率，默认 1。"),
  field("guide_page", "string", "指南书页面 ID。"),
  field("hide_dependency_lines", "boolean", "隐藏指向该任务的依赖线。"),
  field("hide_dependent_lines", "boolean", "隐藏从该任务出发的依赖线。"),
  field("min_required_dependencies", "integer", "至少需要完成多少个依赖才可开始。"),
  field("disable_recipe_mod", "boolean", "在配方查看器中隐藏该任务。"),
  field("hide_until_deps_visible", "boolean", "依赖可见前隐藏该任务。"),
  field("hide_until_deps_complete", "boolean", "依赖完成前隐藏该任务。"),
  field("dependency_requirement", "string", "依赖满足规则。", { enum: DEPENDENCY_REQUIREMENTS }),
  field("hide_text_until_complete", "boolean", "完成前隐藏描述文本。"),
  field("icon_scale", "number", "图标缩放倍率。"),
  field("min_width", "integer", "任务详情面板最小宽度。"),
  field("can_repeat", "boolean", "任务是否可重复完成。"),
  field("invisible", "boolean", "始终隐藏该任务。"),
  field("invisible_until_tasks", "integer", "完成指定数量任务前隐藏。"),
  field("ignore_reward_blocking", "boolean", "忽略奖励阻塞。"),
  field("progression_mode", "string", "进度模式。", { enum: PROGRESSION_MODES }),
  field("hide_details_until_startable", "boolean", "开始前隐藏详情。"),
  field("require_sequential_tasks", "boolean", "强制按顺序完成子任务。"),
  field("hide_lock_icon", "boolean", "隐藏锁定图标。"),
  field("max_completable_dependents", "integer", "最多允许同时完成的下游任务数。"),
  field("repeat_cooldown", "integer", "重复任务冷却（秒）。"),
  field("optional", "boolean", "标记为可选任务。"),
  field("disable_toast", "boolean", "完成时不显示 toast。"),
  field("dependencies", "string[]", "依赖的 quest ID 列表。"),
  field("tasks", "object[]", "任务列表；字段随 type 变化。"),
  field("rewards", "object[]", "奖励列表；字段随 type 变化。"),
];

export const CHAPTER_FIELDS = [
  field("id", "string", "章节 ID。"),
  field("filename", "string", "章节文件名（不含 .snbt）；通常与 id 相同。"),
  field("group", "string", "所属 chapter group ID。"),
  field("default_quest_shape", "string", "章节默认节点形状。", { enum: ["", ...QUEST_SHAPES] }),
  field("default_quest_size", "number", "章节默认节点尺寸。"),
  field("default_hide_dependency_lines", "boolean", "默认隐藏依赖线。"),
  field("default_min_width", "integer", "默认详情面板最小宽度。"),
  field("progression_mode", "string", "进度模式。", { enum: PROGRESSION_MODES }),
  field("consume_items", "boolean|string", "默认是否消耗任务物品。"),
  field("always_invisible", "boolean", "章节始终不可见。"),
  field("hide_quest_until_deps_visible", "boolean", "默认隐藏直到依赖可见。"),
  field("hide_quest_until_deps_complete", "boolean", "默认隐藏直到依赖完成。"),
  field("hide_text_until_complete", "boolean", "默认完成前隐藏描述。"),
  field("default_repeatable_quest", "boolean", "默认任务可重复。"),
  field("require_sequential_tasks", "boolean", "默认强制顺序完成。"),
  field("autofocus_id", "string", "打开章节时自动聚焦的任务 ID。"),
  field("quests", "object[]", "任务列表。"),
  field("quest_links", "object[]", "指向其他章节任务的链接节点。"),
  field("images", "object[]", "章节背景图。"),
];

export const CHAPTER_IMAGE_FIELDS = [
  field("image", "string", "图标资源 ID，例如 minecraft:textures/...。"),
  field("x", "number", "X 坐标。"),
  field("y", "number", "Y 坐标。"),
  field("width", "number", "宽度。"),
  field("height", "number", "高度。"),
  field("rotation", "number", "旋转角度。"),
  field("color", "integer", "染色颜色。"),
  field("alpha", "integer", "透明度 0-255。"),
  field("order", "integer", "绘制顺序。"),
  field("click", "string", "点击行为。"),
  field("hover", "string[]", "悬停提示。"),
  field("editors_only", "boolean", "仅编辑模式可见。"),
  field("align_to_corner", "boolean", "按角对齐。"),
  field("dependency", "string", "可见性依赖的 quest ID。"),
];

export const QUEST_LINK_FIELDS = [
  field("linked_quest", "string", "被链接任务的 ID。"),
  field("x", "number", "X 坐标。"),
  field("y", "number", "Y 坐标。"),
  field("shape", "string", "节点形状。", { enum: ["", ...QUEST_SHAPES] }),
  field("size", "number", "节点尺寸。"),
];

export const TASK_COMMON_FIELDS = [
  field("id", "string", "任务 ID；文件内唯一。"),
  field("type", "string", "任务类型。", { enum: TASK_TYPES }),
  field("optional_task", "boolean", "是否为可选子任务。"),
];

export const REWARD_COMMON_FIELDS = [
  field("id", "string", "奖励 ID；文件内唯一。"),
  field("type", "string", "奖励类型。", { enum: REWARD_TYPES }),
  field("team", "boolean", "是否团队共享。"),
  field("autoclaim", "string", "自动领取模式。"),
  field("exclude_from_claim_all", "boolean", "一键领取时跳过。"),
];

export const TASK_TYPE_FIELDS = {
  item: ["item", "count", "consume_items", "only_from_crafting", "match_components", "task_screen_only"],
  xp: ["value"],
  advancement: ["advancement", "criterion"],
  kill: ["entity", "value", "custom_name", "nbt_filter"],
  fluid: ["fluid", "amount"],
  dimension: ["dimension"],
  biome: ["biome"],
  structure: ["structure"],
  stat: ["stat", "value"],
  observation: ["observe_type"],
  gamestage: ["stage"],
  location: ["dimension", "x", "y", "z", "range"],
  checkmark: [],
  custom: ["data"],
};

export const REWARD_TYPE_FIELDS = {
  item: ["item", "count", "random_bonus", "only_one"],
  choice: ["table"],
  all_table: ["table"],
  random: ["table"],
  loot: ["table"],
  command: ["command", "permission_level", "silent", "feedback_message", "elevate_perms"],
  xp: ["value"],
  xp_levels: ["value"],
  advancement: ["advancement", "criterion"],
  toast: ["description"],
  gamestage: ["stage"],
  currency: ["value"],
  custom: ["data"],
};

export const PATCH_FIELDS = [
  field("x", "number", "坐标，范围 ±10000，最多 6 位小数。"),
  field("y", "number", "坐标，范围 ±10000，最多 6 位小数。"),
  field("title", "string", "写入所选语言的 quest.<id>.title，最长 8000 字符。"),
  field("subtitle", "string", "写入 quest.<id>.quest_subtitle，最长 8000 字符。"),
  field("description", "string[]", "写入 quest.<id>.quest_desc，最多 200 行，每行最长 8000 字符。"),
];

export function schemaSnapshot() {
  return {
    game: "Minecraft 1.21.1",
    ftbQuests: "2101.1.26",
    source: "Derived from the installed FTB Quests jar. Fields not modeled by the current patch API remain read-only.",
    shapes: QUEST_SHAPES,
    dependencyRequirements: DEPENDENCY_REQUIREMENTS,
    progressionModes: PROGRESSION_MODES,
    taskTypes: TASK_TYPES,
    rewardTypes: REWARD_TYPES,
    sections: {
      quest: { fields: QUEST_FIELDS },
      chapter: { fields: CHAPTER_FIELDS },
      chapterImage: { fields: CHAPTER_IMAGE_FIELDS },
      questLink: { fields: QUEST_LINK_FIELDS },
      task: { commonFields: TASK_COMMON_FIELDS, typeFields: TASK_TYPE_FIELDS },
      reward: { commonFields: REWARD_COMMON_FIELDS, typeFields: REWARD_TYPE_FIELDS },
      patch: { fields: PATCH_FIELDS, note: "patch 默认 dry-run；加 --apply 才写文件。" },
    },
  };
}

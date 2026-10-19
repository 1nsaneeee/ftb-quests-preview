import { basename } from "node:path";
import {
  DEPENDENCY_REQUIREMENTS,
  PROGRESSION_MODES,
  QUEST_SHAPES,
  REWARD_TYPES,
  TASK_TYPES,
} from "./schema.mjs";

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

function checkIdFormat(value) {
  return typeof value === "string" && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value);
}

export function lintStore(store) {
  const issues = [];
  const add = (severity, code, message, extra) => issues.push(issue(severity, code, message, extra));
  const groupIds = new Set(store.chapterGroups.map(group => group.id));
  const chapterIdCounts = new Map();
  for (const chapter of store.chapters) {
    if (typeof chapter.raw.id !== "string" || !chapter.raw.id) {
      add("error", "missing-chapter-id", `章节文件 ${chapter.file} 缺少 id`, {
        chapterId: chapter.id,
        file: `chapters/${chapter.file}`,
      });
    }
    chapterIdCounts.set(chapter.id, (chapterIdCounts.get(chapter.id) ?? 0) + 1);
  }
  for (const [id, count] of chapterIdCounts) {
    if (count > 1) add("error", "duplicate-chapter-id", `章节 ID '${id}' 出现 ${count} 次`, { chapterId: id });
  }

  for (const [id, quests] of store.duplicateQuestIds) {
    add("error", "duplicate-quest-id", `任务 ID '${id}' 在多个章节中出现`, {
      questId: id,
      files: quests.map(quest => `chapters/${quest.chapterFile}`),
      hint: "FTB Quests 依赖 ID 定位任务；重复 ID 会让其中一部分任务不可达。",
    });
  }

  for (const [id, objects] of store.duplicateObjectIds) {
    if (objects.length < 2) continue;
    add("error", "duplicate-object-id", `task/reward ID '${id}' 出现 ${objects.length} 次`, {
      id,
      questIds: [...new Set(objects.map(item => item.questId))],
      hint: "task 与 reward 的 ID 也应全局唯一。",
    });
  }

  for (const id of store.duplicateObjectIds.keys()) {
    if (store.questsById.has(id)) {
      add("error", "object-id-collision", `task/reward ID '${id}' 与 quest ID 冲突`, {
        id,
        hint: "FTB Quests 用同一 ID 空间定位对象；不同对象之间不要复用 ID。",
      });
    }
    if (chapterIdCounts.has(id)) {
      add("error", "object-id-collision", `task/reward ID '${id}' 与 chapter ID 冲突`, {
        id,
        hint: "FTB Quests 用同一 ID 空间定位对象；不同对象之间不要复用 ID。",
      });
    }
  }

  const adjacency = new Map();
  for (const chapter of store.chapters) {
    if (chapter.filename && chapter.filename !== basename(chapter.file, ".snbt")) {
      add("warning", "chapter-filename-mismatch", `章节 filename '${chapter.filename}' 与文件 ${chapter.file} 不一致`, {
        chapterId: chapter.id,
        file: `chapters/${chapter.file}`,
      });
    }
    if (chapter.group && !groupIds.has(chapter.group)) {
      add("warning", "missing-chapter-group", `章节引用了不存在的分组 '${chapter.group}'`, {
        chapterId: chapter.id,
        file: `chapters/${chapter.file}`,
        hint: "检查 chapter_groups.snbt 与 chapter_group.<id>.title。",
      });
    }
    if (chapter.raw.default_quest_shape && !QUEST_SHAPES.includes(chapter.raw.default_quest_shape)) {
      add("warning", "unknown-shape", `章节默认形状 '${chapter.raw.default_quest_shape}' 不在已知列表中`, {
        chapterId: chapter.id,
        file: `chapters/${chapter.file}`,
        allowed: QUEST_SHAPES,
      });
    }
    if (Number.isFinite(chapter.raw.default_quest_size) && chapter.raw.default_quest_size <= 0) {
      add("warning", "invalid-size", "章节默认节点尺寸应大于 0", { chapterId: chapter.id, file: `chapters/${chapter.file}` });
    }
    if (chapter.raw.progression_mode && !PROGRESSION_MODES.includes(chapter.raw.progression_mode)) {
      add("warning", "unknown-progression-mode", `未知 progression_mode '${chapter.raw.progression_mode}'`, {
        chapterId: chapter.id,
        file: `chapters/${chapter.file}`,
        allowed: PROGRESSION_MODES,
      });
    }
    if (chapter.quests.length === 0 && chapter.questLinks.length === 0 && chapter.images.length === 0) {
      add("warning", "empty-chapter", "章节没有任务、链接或图片", { chapterId: chapter.id, file: `chapters/${chapter.file}` });
    }

    for (const link of chapter.questLinks) {
      if (!isObject(link) || typeof link.linked_quest !== "string" || !store.questsById.has(link.linked_quest)) {
        add("error", "missing-linked-quest", "quest_link 指向不存在的任务", {
          chapterId: chapter.id,
          file: `chapters/${chapter.file}`,
          linkedQuest: isObject(link) ? link.linked_quest ?? null : null,
        });
      } else if (link.shape && !QUEST_SHAPES.includes(link.shape)) {
        add("warning", "unknown-shape", `quest_link 使用了未知形状 '${link.shape}'`, {
          chapterId: chapter.id,
          file: `chapters/${chapter.file}`,
        });
      }
    }

    const coordinateOwners = new Map();
    for (const quest of chapter.quests) {
      if (!quest.id) {
        add("error", "missing-quest-id", "有一个任务缺少 id", { chapterId: chapter.id, file: `chapters/${chapter.file}`, line: quest.line });
        continue;
      }
      if (quest.titleSource === "id" && !store.translatedTitleIds.has(quest.id)) {
        add("warning", "untranslated-title", `任务 '${quest.id}' 没有任何语言的标题，也没有内联 title`, {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
          hint: `补充任意一个 lang/<locale>.snbt 中的 quest.${quest.id}.title。`,
        });
      }
      if (quest.shape && !QUEST_SHAPES.includes(quest.shape)) {
        add("warning", "unknown-shape", `任务使用了未知形状 '${quest.shape}'`, {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
      }
      if (quest.icon && !checkIdFormat(quest.icon)) {
        add("warning", "invalid-icon", `icon '${quest.icon}' 不是 namespace:path 格式`, {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
      }
      if (quest.raw.size !== undefined && (!Number.isFinite(quest.raw.size) || quest.raw.size <= 0)) {
        add("warning", "invalid-size", "任务 size 应为大于 0 的数字", {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
      }
      if (quest.raw.min_width !== undefined && (!Number.isFinite(quest.raw.min_width) || quest.raw.min_width < 0)) {
        add("warning", "invalid-min-width", "任务 min_width 应为非负数字", {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
      }
      if (quest.raw.repeat_cooldown !== undefined && (!Number.isFinite(quest.raw.repeat_cooldown) || quest.raw.repeat_cooldown < 0)) {
        add("warning", "negative-repeat-cooldown", "repeat_cooldown 应为非负数字", {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
      }
      if (quest.raw.dependency_requirement && !DEPENDENCY_REQUIREMENTS.includes(quest.raw.dependency_requirement)) {
        add("warning", "unknown-dependency-requirement", `未知 dependency_requirement '${quest.raw.dependency_requirement}'`, {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
          allowed: DEPENDENCY_REQUIREMENTS,
        });
      }
      if (quest.raw.progression_mode && !PROGRESSION_MODES.includes(quest.raw.progression_mode)) {
        add("warning", "unknown-progression-mode", `未知 progression_mode '${quest.raw.progression_mode}'`, {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
          allowed: PROGRESSION_MODES,
        });
      }

      if (quest.raw.dependencies !== undefined && !Array.isArray(quest.raw.dependencies)) {
        add("error", "invalid-dependencies", "dependencies 必须是数组", {
          questId: quest.id,
          chapterId: chapter.id,
          file: `chapters/${quest.chapterFile}`,
        });
        if (!adjacency.has(quest.id)) adjacency.set(quest.id, []);
      } else {
        const dependencies = quest.dependencies;
        if (new Set(dependencies).size !== dependencies.length) {
          add("warning", "duplicate-dependency", "dependencies 中有重复 ID", {
            questId: quest.id,
            chapterId: chapter.id,
            file: `chapters/${quest.chapterFile}`,
          });
        }
        for (const dependency of dependencies) {
          if (dependency === quest.id) {
            add("error", "self-dependency", "任务依赖了自己", {
              questId: quest.id,
              chapterId: chapter.id,
              file: `chapters/${quest.chapterFile}`,
            });
          } else if (!store.questsById.has(dependency)) {
            add("error", "missing-dependency", `依赖的任务 '${dependency}' 不存在`, {
              questId: quest.id,
              dependency,
              chapterId: chapter.id,
              file: `chapters/${quest.chapterFile}`,
            });
          }
        }
        if (Number.isFinite(quest.raw.min_required_dependencies)
          && quest.raw.min_required_dependencies > dependencies.length) {
          add("warning", "impossible-dependency-count", `min_required_dependencies=${quest.raw.min_required_dependencies} 大于依赖数量 ${dependencies.length}`, {
            questId: quest.id,
            chapterId: chapter.id,
            file: `chapters/${quest.chapterFile}`,
          });
        }
        if (!adjacency.has(quest.id)) {
          adjacency.set(quest.id, dependencies.filter(dependency => store.questsById.has(dependency)));
        }
      }

      if (quest.x !== null && quest.y !== null) {
        const key = `${quest.x},${quest.y}`;
        if (!coordinateOwners.has(key)) coordinateOwners.set(key, []);
        coordinateOwners.get(key).push(quest.id);
      }
      for (const axis of ["x", "y"]) {
        const value = quest.raw[axis];
        if (value !== undefined && (!Number.isFinite(value) || Math.abs(value) > 10_000)) {
          add("error", "invalid-coordinate", `${axis} 坐标无效或超出 ±10000`, {
            questId: quest.id,
            chapterId: chapter.id,
            file: `chapters/${quest.chapterFile}`,
          });
        }
      }

      if (quest.raw.tasks !== undefined && !Array.isArray(quest.raw.tasks)) {
        add("error", "invalid-tasks", "tasks 必须是数组", { questId: quest.id, chapterId: chapter.id, file: `chapters/${quest.chapterFile}` });
      }
      if (quest.raw.rewards !== undefined && !Array.isArray(quest.raw.rewards)) {
        add("error", "invalid-rewards", "rewards 必须是数组", { questId: quest.id, chapterId: chapter.id, file: `chapters/${quest.chapterFile}` });
      }
      for (const [kind, list, allowed] of [["task", quest.tasks, TASK_TYPES], ["reward", quest.rewards, REWARD_TYPES]]) {
        for (const object of list) {
          if (!isObject(object)) {
            add("error", `invalid-${kind}`, `${kind} 必须是对象`, { questId: quest.id, chapterId: chapter.id, file: `chapters/${quest.chapterFile}` });
            continue;
          }
          if (typeof object.id !== "string" || !object.id) {
            add("error", `missing-${kind}-id`, `${kind} 缺少 id`, { questId: quest.id, chapterId: chapter.id, file: `chapters/${quest.chapterFile}` });
          }
          if (typeof object.type !== "string" || !object.type) {
            add("error", `missing-${kind}-type`, `${kind} ${object.id ?? "(no id)"} 缺少 type`, {
              questId: quest.id,
              chapterId: chapter.id,
              file: `chapters/${quest.chapterFile}`,
            });
          } else if (!allowed.includes(object.type)) {
            add("warning", `unknown-${kind}-type`, `${kind} 类型 '${object.type}' 不在已知列表中`, {
              questId: quest.id,
              objectId: object.id ?? null,
              chapterId: chapter.id,
              file: `chapters/${quest.chapterFile}`,
              allowed,
              hint: "可能是模组扩展类型；确认对应模组已安装。",
            });
          }
        }
      }
    }
    for (const [coordinate, questIds] of coordinateOwners) {
      if (questIds.length > 1) {
        add("warning", "duplicate-coordinate", `任务 ${questIds.join(", ")} 使用相同坐标 (${coordinate})`, {
          chapterId: chapter.id,
          file: `chapters/${chapter.file}`,
          questIds,
        });
      }
    }
  }

  const reportedCycles = new Set();
  const state = new Map();
  const stack = [];
  const visit = id => {
    state.set(id, 1);
    stack.push(id);
    for (const dependency of adjacency.get(id) ?? []) {
      const status = state.get(dependency) ?? 0;
      if (status === 1) {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = [...new Set(cycle)].sort().join(">");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          add("error", "dependency-cycle", `依赖环：${cycle.join(" → ")}`, {
            questId: dependency,
            path: cycle,
            hint: "FTB Quests 会拒绝或无法完成循环依赖。",
          });
        }
      } else if (status === 0) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of store.questsById.keys()) if (!state.has(id)) visit(id);

  issues.sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || String(left.code).localeCompare(String(right.code))
    || String(left.file ?? "").localeCompare(String(right.file ?? ""))
    || String(left.questId ?? "").localeCompare(String(right.questId ?? ""))
  ));
  const summary = { error: 0, warning: 0, info: 0 };
  for (const value of issues) summary[value.severity] += 1;
  return { issues, summary, strictFailed: summary.error > 0 };
}

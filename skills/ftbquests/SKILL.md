---
name: ftbquests
description: 读取、校验、编辑和预览 Minecraft FTB Quests 任务数据（chapters/*.snbt、lang/*.snbt）。当用户要查看任务/章节、修改节点坐标或标题/副标题/描述、检查依赖/ID/语言/坐标问题，或为整合包做任务书编辑时使用。优先使用 `ftbquest` CLI，而不是手动改 SNBT。已验证 Minecraft 1.21.1 + FTB Quests 2101.1.26。
---

# FTB Quests 编辑

## 这个工具是什么

`ftbquest` 是 quest-preview 的无头 CLI，直接读写 FTB Quests 的 SNBT 数据。它提供结构化读取、lint、schema 和带 dry-run 的 patch；写入会先做版本校验，并自动备份到 quest 数据目录下的 `.quest-preview-backups/`。

`ftbquest-preview` 是同一项目的人类浏览器界面，AI 不需要用它来编辑。

## 先确认命令可用

```sh
ftbquest --version
```

如果提示 command not found，在项目目录运行 `npm link`，然后重试。不要改回 `node cli.mjs`；CLI 已经作为 bin 安装。

如果当前 agent 还没有加载这份 skill，先运行：

```sh
ftbquest skill
```

它会打印完整使用说明；`ftbquest skill --json` 返回路径和内容。

## 数据源

`ftbquest` 支持三种来源：

```sh
ftbquest list --data-dir "PATH/TO/config/ftbquests/quests"
ftbquest list --instance-root "PATH/TO/.minecraft"
ftbquest list --demo
```

- `--data-dir` 指向包含 `chapters/` 的 quests 数据根目录，不是 `.minecraft`。
- `--instance-root` 指向 `.minecraft`（或实例根），CLI 会自动找 `config/ftbquests/quests`。
- 不传时读取当前目录的 `quest-preview.local.json`，再退回内置 demo。
- 相对路径按调用时的当前目录解析。

## 只读工作流

```sh
ftbquest list --data-dir "$QUESTS" --json --brief     # 找章节和 quest ID
ftbquest show <questId> --data-dir "$QUESTS" --json   # 看一个任务
ftbquest show <questId> --data-dir "$QUESTS" --json --raw
ftbquest search "关键词" --data-dir "$QUESTS" --in title,subtitle,description --json
ftbquest deps <questId> --data-dir "$QUESTS" --direction both --depth 2 --json
ftbquest lint --data-dir "$QUESTS" --json
ftbquest schema quest --json
ftbquest schema patch --json
```

- 先 `list` 拿稳定 ID，再 `show`，不要凭标题猜 ID。
- 中文包通常要加 `--locale zh_cn`；默认是 `en_us`。
- `lint` 的 `warning` 默认不改变退出码；CI 用 `--strict`。
- 不要凭记忆写字段；写 patch 前先看 `schema patch`。

## 编辑工作流（必须按顺序）

1. 确认数据源和目标 quest ID。
2. 跑一次基线 `lint`。
3. 写 patch JSON。
4. dry-run，检查 `changes[].hunks` 是否只改了预期文件/行。
5. 确认无误后才加 `--apply`。
6. `show` 回读，再 `lint --strict`。

```sh
ftbquest patch --data-dir "$QUESTS" --file patch.json --json
ftbquest patch --data-dir "$QUESTS" --file patch.json --apply --json
ftbquest show <questId> --data-dir "$QUESTS" --json
ftbquest lint --data-dir "$QUESTS" --json --strict
```

### patch 文件

```json
{
  "locale": "zh_cn",
  "edits": [
    {
      "questId": "ABC123",
      "x": 1.5,
      "y": -1,
      "title": "新标题",
      "subtitle": "新副标题",
      "description": ["第一行", "第二行"]
    }
  ]
}
```

- 目前只能写 `x`、`y`、`title`、`subtitle`、`description`。
- `description` 是字符串数组，最多 200 行、每行最多 8000 字符。
- `x` / `y` 范围 ±10000，最多 6 位小数。
- `title` / `subtitle` 写入所选语言的 `quest.<id>.title` / `quest.<id>.quest_subtitle`。
- patch 里的 `locale` 决定读写语言，优先于 `--locale`。
- 可一次写多个 `edits`；同一次 apply 是原子备份/写入流程。
- 相同 patch 重复 apply 返回 `unchanged: true`，不产生新备份。

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `ftbquest list [--json] [--brief] [--chapter ID]` | 章节、分组、任务摘要 |
| `ftbquest show <id> [--json] [--raw]` | 单任务详情；`--raw` 附带原始 SNBT |
| `ftbquest deps <id> [--direction up\|down\|both] [--depth N]` | 依赖 / 反向依赖，默认 both、深度 1 |
| `ftbquest search <q> [--in ...]` | 搜索 ID/标题/副标题/描述/tasks/rewards |
| `ftbquest lint [--json] [--strict]` | 重复 ID、缺失/循环依赖、坐标、形状、类型、标题等 |
| `ftbquest schema [section]` | quest/chapter/task/reward/patch 字段与枚举 |
| `ftbquest skill` | 打印这份使用说明（`--json` 返回内容与路径） |
| `ftbquest patch --file <path> [--apply]` | 默认 dry-run；`--apply` 才写 |
| `ftbquest --version` | 版本 |

退出码：`0` 成功，`1` 运行/校验失败，`2` 参数错误。

## 安全与错误处理

- **默认 dry-run**；没有 `--apply` 不会写文件。不要一上来就 apply。
- 写入前服务端会校验文件 revision；返回 `conflict` 时不要原样重试：
  1. 重新 `show` / `list`；
  2. 对比外部改动；
  3. 重新生成 patch 后再 dry-run。
- 冲突错误里有 `path`、`expectedRevision`、`actualRevision`，用它定位哪个文件变了。
- 任何写入都会先备份；恢复方式见 README 的 `.quest-preview-backups/` 说明。不要删除备份。
- 不要为了省事直接 `sed`/手改 SNBT；会破坏注释、BOM、行尾或 SNBT 结构。CLI 不支持某字段时，先告诉用户限制，不要伪造字段。
- 不要在未确认数据源时批量修改；一次 patch 尽量只包含同一目标的改动。
- 游戏内生效需要 FTB Quests 重载/重开界面，CLI 不会向运行中的游戏发命令。

## 常见任务

**移动节点**

```json
{ "edits": [{ "questId": "ABC", "x": 4.5, "y": -2 }] }
```

**改标题/描述（中文包）**

```json
{ "locale": "zh_cn", "edits": [{ "questId": "ABC", "title": "新标题", "description": ["新正文"] }] }
```

**批量改多个任务**：在 `edits` 里放多个 `questId`，一次 dry-run 检查所有文件。

**找坏依赖/循环**：

```sh
ftbquest lint --data-dir "$QUESTS" --json --strict
```

**查某个任务被谁依赖**：

```sh
ftbquest deps "<questId>" --data-dir "$QUESTS" --direction down --depth 2 --json
```

**查某任务依赖了谁**：

```sh
ftbquest deps "<questId>" --data-dir "$QUESTS" --direction up --depth 2 --json
```

## 限制

- 只写 `x`/`y`/`title`/`subtitle`/`description`；tasks、rewards、flags、章节图片、quest links 暂时只读。
- 只验证 1.21.1 + FTB Quests 2101.1.26 的常见格式；其他版本先让用户确认，不要声称兼容。
- 不读玩家存档进度，不代替游戏内 FTB Quests 的解锁/完成逻辑。
- 不要发布 npm 包、不要改全局配置，除非用户明确要求。

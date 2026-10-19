# FTB Quests Preview

本地运行的 FTB Quests 图谱预览与简易编辑器。它读取你明确选择的实例 quest 数据，在浏览器里浏览章节、任务详情和节点依赖，并可以：

- 拖拽节点，或直接输入 `x` / `y` 坐标来摆放节点；
- 修改指定任务的标题、副标题和正文；
- 保存前自动创建可恢复的文件备份；
- 检测文件被其他程序改动后的保存冲突，避免覆盖新内容。

服务只监听 `127.0.0.1`，不连接任何远端服务。保存只会改动支持的 SNBT 字段，并把备份放在 quest 数据目录下的 `.quest-preview-backups/`。

## 环境要求

- Node.js **20 或更新版本**；推荐 Node.js 24 LTS（自带 npm）。
  - 下载：<https://nodejs.org/en/download>
  - 检查版本：`node --version`
- 不需要 `npm install`（项目没有第三方 npm 依赖）。
- 不需要管理员权限，不需要修改 `PATH`，不需要调整 PowerShell Execution Policy。
- 安装脚本不会下载或升级 Node.js。

## 安装

先下载或解压本项目，然后进入项目目录完成一次配置。配置会写入项目根目录的 `quest-preview.local.json`，该文件已被 Git 忽略。

### Windows：双击安装

1. 安装 Node.js 20+。
2. 双击项目里的 `install.cmd`。
3. 按提示选择数据来源：
   - `1` Minecraft 实例目录（通常包含 `config/`、`mods/`、`resourcepacks/`）；
   - `2` 单独的 quests 数据目录（必须包含 `chapters/`，`lang/` 可选）；
   - `3` 内置 demo（用于先试用编辑功能，不会碰真实任务文件）。
4. 看到 `Local setup saved to ...` 即安装完成。

安装脚本只写本地配置文件，不会创建开机启动项，也不会改动游戏文件。

### 安装为全局命令（npm 包 + PowerShell）

`install.ps1` 是“安装工具本身”的脚本，和上面的 `install.cmd`（配置 quest 数据源）不是一回事。它会：

1. 检查 Node.js 20+；
2. 用 `npm pack` 打包当前目录，再 `npm install -g` 安装；
3. 把 npm 全局 bin 目录注册到**用户 PATH**（已存在则跳过）；
4. 把 `skills/ftbquests/` 复制到 agent skills 目录（默认 `%USERPROFILE%\.agents\skills`，不存在时尝试 `.dsh\skills`）；
5. 验证 `ftbquest --version`。

在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后，**新开一个终端**，然后：

```sh
ftbquest --version
ftbquest skill
```

常用参数：

```powershell
# 安装到用户可写目录，避免全局 npm 权限问题
.\install.ps1 -InstallPrefix "$env:LOCALAPPDATA\ftbquests"

# 只安装命令，不改 PATH / 不装 skill
.\install.ps1 -NoPath -NoSkill

# 自定义 skill 目录
.\install.ps1 -SkillDir "$env:USERPROFILE\.agents\skills"
```

也可以先生成 tarball，再手动安装：

```sh
npm pack
npm install -g .\ftb-quests-preview-0.1.0.tgz
```

`install.ps1` 需要当前目录有 `package.json`；安装后 `ftbquest` / `ftbquest-preview` 都是全局命令。开发时想指向当前源码而不是安装副本，用 `npm link` 即可。

### macOS / Linux（或习惯命令行的 Windows）

```sh
npm run setup
```

也可以非交互指定路径：

```sh
npm run setup -- --instance-root "PATH/TO/.minecraft"
npm run setup -- --data-dir "PATH/TO/ftbquests/quests"
npm run setup -- --instance-root "PATH/TO/.minecraft" --data-dir "PATH/TO/quests"
npm run setup -- --demo
```

说明：

- 实例目录通常包含 `config/`、`mods/`、`resourcepacks/`；脚本会检查 `config/ftbquests/quests` 是否存在。
- 单独数据目录必须包含 `chapters/`；`lang/` 可选。缺少语言文件时先用章节内联文本，保存时会创建所选语言文件。
- 已有 `quest-preview.local.json` 时不会隐式覆盖；加 `--replace` 才会先备份旧配置再替换。
- `npm run setup -- --help` 查看全部参数。

### 路径规则

- `npm run setup` / `install.cmd` 传入的路径按**运行安装时的当前目录**解析；交互输入的路径同样如此。
- `quest-preview.local.json` 里的 `instanceRoot` / `dataDir` 默认保存为**相对路径**，并按该配置文件所在目录解析。这样整个项目和实例的相对结构可以一起移动。
- Windows 上跨盘符无法写相对路径时，安装会要求确认，或用 `--absolute-paths` 显式允许把绝对路径写进本地配置。
- `quest-preview.example.json` 展示配置格式；也可以复制成 `quest-preview.local.json` 手工修改。

## 启动

Windows 可以双击 `start.cmd`，或在全局安装后运行：

```sh
ftbquest-preview
```

源码目录里也可以运行 `npm start`。然后打开 <http://127.0.0.1:4173>。停止服务：在终端按 `Ctrl+C`，或关闭 `start.cmd` 的窗口。

启动时的数据源优先级从高到低：

1. 命令行 `--instance-root PATH` / `--data-dir PATH` / `--demo`
2. 环境变量 `QUEST_PREVIEW_INSTANCE_ROOT` / `QUEST_PREVIEW_DATA_DIR`
3. `quest-preview.local.json`
4. 当前目录没有可用任务数据时，退回内置 demo

显式配置的路径失效时会直接报错，不会静默切回 demo。demo 数据首次运行会复制到被忽略的 `.local/demo-quests`，可放心试编辑；仓库内 `fixtures/quests` 保持为原始示例。

端口被占用时，可以换一个端口：

```sh
# macOS / Linux
QUEST_PREVIEW_PORT=4180 npm start

# Windows PowerShell
$env:QUEST_PREVIEW_PORT = "4180"; npm start
```

## 命令行 / AI 编辑接口

除了浏览器，项目还提供一个 headless CLI，适合脚本和 AI Agent。它复用同一套 SNBT parser、配置解析、备份和冲突检测逻辑；默认只做 dry-run，不写文件。

`package.json` 已经把 CLI 注册为 `bin`。在项目目录执行一次：

```sh
npm link
ftbquest --version
```

之后在任意目录都可以直接使用 `ftbquest`（浏览器入口是 `ftbquest-preview`）。`npm link` 只是本地全局链接，不会发布包；卸载用 `npm unlink -g ftb-quests-preview`。

```sh
ftbquest list --json --brief
ftbquest show demo_first --json
ftbquest show demo_first --json --raw
ftbquest search "钢" --in title,subtitle,description --json
ftbquest deps demo_first --direction both --depth 2 --json
ftbquest lint --json --strict
ftbquest schema patch --json
ftbquest skill                                # 打印 AI 使用说明
ftbquest patch --file patch.json --json          # dry-run
ftbquest patch --file patch.json --apply --json  # 真正写入
```

没有 `npm link` 时仍可用 `node cli.mjs ...` 或 `npm run cli -- ...`；AI 场景建议直接用 `ftbquest`，避免 npm 的启动日志混进 JSON 输出。

数据源参数和 `npm start` 相同：`--data-dir`、`--instance-root`、`--demo`，否则读取 `quest-preview.local.json`。`--locale` 默认 `en_us`；中文包建议显式传 `--locale zh_cn`。patch 文件里的 `locale` 优先级更高，会同时决定读取和写入语言。

### 命令

| 命令 | 作用 |
| --- | --- |
| `list` | 列出章节和任务；`--brief` 只返回 ID、标题、章节、坐标 |
| `show <questId>` | 查看一个任务；`--raw` 附带原始 SNBT 模型 |
| `deps <questId>` | 查看依赖/反向依赖；`--direction up,down,both`，`--depth 1-20` |
| `search <query>` | 搜索任务；`--in` 指定 `id,title,subtitle,description,tasks,rewards` |
| `lint` | 检查重复 ID、缺失/循环依赖、非法坐标、未知形状/任务/奖励类型、无任何语言标题等；`--strict` 在 error 时退出 1 |
| `schema [section]` | 输出 FTB Quests 字段模型、枚举、task/reward 类型和 patch 限制 |
| `skill` | 打印内置的 AI 使用说明；`--json` 返回路径和内容 |
| `patch --file <path>` | 应用 JSON patch；默认 dry-run，`--apply` 才写 |

### patch 格式

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

- 当前可写字段：`x`、`y`、`title`、`subtitle`、`description`。`schema` 会列出完整字段模型，但其余字段暂时只读。
- patch 里的 `locale` 决定读取和写入的语言；不写时用 `--locale`，再缺省为 `en_us`。
- `description` 是字符串数组，最多 200 行，每行最多 8000 字符。
- 默认 dry-run 会返回改动文件、行号和 unified diff，不创建备份、不写文件；`--apply` 才落盘并生成 `.quest-preview-backups/<timestamp>/`。
- 相同 patch 重复执行是幂等的：没有实际变化时返回 `unchanged: true`，不产生备份。
- 并发修改会让命令返回 `conflict`，并带上 `path`、`expectedRevision`、`actualRevision`；重新读取数据、重做修改后再执行，不要盲目重试。
- `--json` 输出统一为 `{ ok, command, ... }`；错误为 `{ ok: false, error: { code, message, ... } }`。退出码：`0` 成功，`1` 运行/校验失败，`2` 参数错误。
- `lint --strict` 适合放进 CI；`patch --strict` 会在写完后按 lint 结果决定退出码，备份仍可手动恢复。

`lint` 目前覆盖：重复 quest/task/reward ID、缺失依赖、自依赖、依赖环、重复坐标、非法坐标、未知 shape、未知 task/reward 类型、缺失 task/reward 的 `id`/`type`、章节名单与 `filename` 不一致、缺失章节分组、`min_required_dependencies` 不可满足、重复依赖、无任何语言标题等。

### AI Skill

仓库内有一个给 agent 用的 skill：[skills/ftbquests/SKILL.md](skills/ftbquests/SKILL.md)。它描述什么时候用 `ftbquest`、只读/编辑工作流、patch 格式、安全检查、常见任务和限制。

`install.ps1` 默认会自动把它复制到 agent skills 目录。手动安装时，把整个 `skills/ftbquests/` 目录复制过去即可，例如：

```sh
# Unix-like / 本项目 harness
cp -r skills/ftbquests ~/.agents/skills/
```

```powershell
# Windows PowerShell
Copy-Item -Recurse skills\ftbquests "$env:USERPROFILE\.agents\skills\"
```

之后 agent 在遇到 FTB Quests 编辑任务时会优先使用 `ftbquest`，而不是手改 SNBT。没有 skill 系统时，直接让 agent 运行 `ftbquest skill` 或阅读 `skills/ftbquests/SKILL.md` 也可以。

## 使用

### 浏览

- 左侧选择章节和任务；搜索框可搜索章节或任务（快捷键 `/`）。
- 右上切换「任务详情」和「章节任务图」。任务图支持拖动空白处平移、滚轮缩放、方向键切换节点、回车打开详情。
- 右侧「预览设置」可切换语言（详情和任务图共用）、面板宽度、GUI 缩放和说明分页。

### 编辑节点位置

1. 打开「章节任务图」。
2. 点击「编辑布局」，按钮变为「退出编辑」。
3. 拖动任意节点即可移动；默认吸附到 `0.5` 网格，可在右侧关闭吸附。
4. 也可以不进入任务图，直接在右侧「编辑当前任务」里输入 `X` / `Y` 后按回车或点击别处生效。
5. 右侧「待保存 N 处」会显示尚未保存的字段数，点击「保存更改」写回文件。

编辑只改变当前所选语言的文本覆盖，以及该任务所属 chapter SNBT 里的 `x` / `y`。不会改动 tasks、rewards、conditions、dependencies、章节设置或贴图资源。

### 编辑任务文本

- **标题**、**副标题**：在右侧「编辑当前任务」中修改。
- **正文/说明**：在右下角「任务说明」文本框中修改；正文和其他字段共用同一个保存草稿。
- 标题、副标题和正文会写入所选语言的 `lang/<locale>.snbt`（FTB Quests 使用的键为 `quest.<id>.title`、`quest.<id>.quest_subtitle`、`quest.<id>.quest_desc`）。
- 正文按行保存，支持预览器已支持的 `&` 颜色/格式码、空行、独占一行的 `{@pagebreak}` 和 `{image:...}`。

### 保存、备份和恢复

点击「保存更改」后：

- 服务器先校验文件版本，再把原始文件按相对路径备份到 quest 数据目录下的 `.quest-preview-backups/<UTC 时间戳>-<随机串>/`，页面会显示这次备份的相对位置。
- 只有校验通过的字段会被写入；同一次保存涉及多个文件时，任一文件写入失败会尝试回滚已写入的文件。
- 保存后预览会自动刷新。游戏内是否立即更新取决于 FTB Quests 的重载/重新打开行为；本工具不会向运行中的游戏发送命令。

需要恢复时：

1. 停止或暂停编辑，关闭页面。
2. 打开 `.quest-preview-backups/` 里对应批次的 `manifest.json`。
3. 对 `originalExists: true` 的文件，把备份文件按 `path` 复制回 quest 数据目录。
4. 对 `originalExists: false` 的文件（通常是新建的语言文件），删除该次保存创建的文件。
5. 重新启动或刷新预览。

备份属于用户数据，不会自动清理。

### 冲突与放弃

- 如果页面打开后文件被其他程序修改，页面会提示源文件已变化。此时保存会被服务器拒绝（HTTP 409），草稿会保留，不会覆盖新内容。
- 解决方式：先确认外部改动，点击「放弃更改 / 重新载入」重新读取最新文件，再重做需要的修改并保存。
- 「放弃更改 / 重新载入」会清除当前语言的所有未保存草稿；重要改动请先截图或复制到文本编辑器。
- 页面关闭时如果仍有未保存草稿，浏览器会弹出离开确认。

## 当前预览范围

- 查看图谱、跨章节依赖、章节/任务文本；切换 `zh_cn` / `en_us`（以及数据目录中可用的其他语言）、搜索任务。
- 调节预览面板宽度、GUI scale 和描述分页；本地草稿可以先预览再保存。
- 绘制已安装 Minecraft ASCII atlas 与本机可用的 Unihex 字形；没有资源时使用浏览器 fallback。
- 支持常见文本格式码、独占一行的 `{@pagebreak}` 与一种常见单行 `{image:...}` 描述组件。详情正文会按支持的文本规则排版，但不是完整 FTB Quests 描述组件渲染器。
- 图谱读取 SNBT 坐标、形状、大小、依赖和默认值；chapter `images` 目前由 API 传递，但不绘制。
- 物品/任务/奖励是紧凑摘要，不是 Minecraft 3D widget，也不声称与游戏逐像素一致。

目前实际验证过的本机格式是 Minecraft `1.21.1` 与 FTB Quests `2101.1.26`。SNBT reader 是针对该格式与本项目读取范围编写的小型 parser，不是通用 NBT 实现；其他 Minecraft/FTB Quests 版本尚未声明兼容。

## 常见问题

**Node.js 版本太旧**

安装脚本会检查主版本号。升级到 Node.js 20+ 后重新运行 `install.cmd` 或 `npm run setup`。

**提示找不到 `chapters/`**

`--data-dir` 要指向 quests 数据根目录本身，例如 `.../config/ftbquests/quests`，而不是它的上一级。目录里应直接看到 `chapters/`。

**端口 4173 已被占用**

用 `QUEST_PREVIEW_PORT` 换端口启动，见上文「启动」。

**想重新选择实例**

运行 `npm run setup -- --replace`，或删除 `quest-preview.local.json` 后重新运行 `install.cmd` / `npm run setup`。旧配置会先备份为 `.bak-<时间戳>`。

**保存后游戏里没变化**

本工具只改文件。请让 FTB Quests 重新加载任务数据（按整合包/服务器的方式重载，或重新打开任务界面/重启游戏）。工具不会向游戏发送命令。

**保存被拒绝并显示 conflict**

说明文件在页面打开后被其他程序改过。按「冲突与放弃」一节的步骤重新载入，不要直接重试覆盖。

**中文显示为方块或缺字**

预览器优先读取所选实例的 Minecraft 字库与 Unihex 资源。实例目录没选对、资源缺失或版本不匹配时会退回浏览器字体。保存功能不依赖字体资源。

**想重置 demo 的试编辑**

demo 的编辑副本和备份都在 `.local/demo-quests/`。关闭服务后删除该目录，再次启动会从 `fixtures/quests` 重新复制一份干净的 demo。这个目录已被 Git 忽略。

## 开发检查

```sh
npm run check
npm test
```

`npm run check` 会对项目内所有 `.js` / `.mjs` / `.cjs` 做语法检查；`npm test` 运行配置、安装、SNBT 读写、保存回滚与冲突检测等测试。

## English quick start

Requires Node.js 20+; Node.js 24 LTS is recommended. Get it from the [official download page](https://nodejs.org/en/download). No `npm install` is needed.

1. Unzip or clone this project.
2. Run `install.cmd` on Windows (double-click) or `npm run setup` in a terminal. Choose a Minecraft instance, a quests folder containing `chapters/`, or the bundled demo.
3. Start with `start.cmd` on Windows or `npm start` anywhere, then open <http://127.0.0.1:4173>.
4. Edit coordinates (drag nodes in "章节任务图" → "编辑布局", or type X/Y) and quest title/subtitle/description, then click "保存更改".

Setup writes ignored local configuration with relative paths when possible. Saves are limited to `x`, `y`, `title`, `subtitle`, and `description`; every save creates a recoverable backup under `.quest-preview-backups/`. See the Chinese sections above for path rules, conflict handling, recovery, and fidelity limits.

For scripts and AI agents there is also a headless CLI:

```sh
node cli.mjs list --json --brief
node cli.mjs show <questId> --json --raw
node cli.mjs lint --json --strict
node cli.mjs schema patch --json
node cli.mjs patch --file patch.json --json          # dry-run
node cli.mjs patch --file patch.json --apply --json  # write
```

Patch accepts `questId` plus `x`, `y`, `title`, `subtitle`, and `description`; dry-run returns changed files and line hunks, and `--apply` creates backups.

## License

项目源码按 MIT License 发布，见 [LICENSE](LICENSE)。Minecraft、FTB Quests、资源包及模组资源不随项目分发，也不属于该项目许可证覆盖内容。

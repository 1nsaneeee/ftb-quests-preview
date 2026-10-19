# FTB Quests Preview

一个跑在本机的 FTB Quests 任务书预览和编辑器。选好整合包实例或 quests 目录后，可以在浏览器里看章节、任务详情和节点依赖，也可以通过拖拽或改文本调整任务。

它只监听 `127.0.0.1`，不连外部服务。保存前会把原文件备份到 quest 数据目录下的 `.quest-preview-backups/`。

## 安装

需要 Node.js 20+，推荐 24 LTS。

npm 上最新是 0.1.1：

```sh
npm install -g ftb-quests-preview
ftbquest --version
```

离线安装也可以用 GitHub Release 的 tarball：`npm install -g .\ftb-quests-preview-0.1.1.tgz`。

从源码跑：

```sh
npm install
npm run build
npm link        # 可选
ftbquest
```

`npm run build` 会生成 `editor-assets/description-editor.bundle.js`；改过编辑器或补全逻辑后要重新跑一次。

命令是 `ftbquest`（单数），`ftbquest-preview` 是同一个入口的别名。卸载用 `npm uninstall -g ftb-quests-preview`。

## 启动和数据源

```sh
ftbquest
```

第一次启动没有配置时，浏览器会打开设置页。选 Minecraft 实例、quests 目录（里面直接有 `chapters/`），或者内置 demo。配置写在用户配置目录，不写进 npm 包。

日常也可以直接指定：

```sh
ftbquest --data-dir "E:\...\config\ftbquests\quests"
ftbquest --instance-root "E:\...\.minecraft"
ftbquest --demo
```

数据源按这个顺序找：命令行参数 → `QUEST_PREVIEW_INSTANCE_ROOT` / `QUEST_PREVIEW_DATA_DIR` / `FTBQUEST_CONFIG` → 当前目录的 `quest-preview.local.json` → 用户配置目录。都没有才进设置页。用户配置目录在 Windows 是 `%APPDATA%\ftb-quests-preview`，macOS 和 Linux 在各自的标准配置路径下。

显式指定的路径不存在会直接报错，不会悄悄回退到 demo。配置文件里的相对路径按配置文件所在目录解析。

默认端口 4173，被占用时换一个：

```sh
$env:QUEST_PREVIEW_PORT = "4180"; ftbquest   # PowerShell
QUEST_PREVIEW_PORT=4180 ftbquest             # macOS / Linux
```

重新配置：打开 <http://127.0.0.1:4173/setup.html>。源码目录也可以用 `npm run setup` 生成项目内配置。

## 怎么用

### 看任务

左侧选章节和任务，搜索框可以按分组、章节或标题找（`/` 聚焦，在正文编辑器里不会触发）。右上在「任务详情」和「章节任务图」之间切换；任务图能拖动、滚轮缩放、方向键换节点、回车打开详情。

右侧「预览设置」调语言、面板宽度和 GUI 缩放。分页按钮在预览下方，画布里的「上一页 / 下一页」也能直接点。

### 改节点位置

打开「章节任务图」，点「编辑布局」，拖节点即可，默认吸附 0.5 网格。也可以直接在右侧「编辑当前任务」里填 X / Y。改完点「保存更改」。

只会写当前语言的文本覆盖和 chapter SNBT 里的 `x` / `y`，不动 tasks、rewards、dependencies 这些字段。

### 改文字

标题和副标题在右侧改。正文在预览下方的编辑器里改，和标题共用同一个保存草稿。

编辑器支持 FTB 的格式码和描述组件，输入时有补全：

- `&` 或 `§` 给出颜色和格式码，带色块；
- `{` 给出 `{@pagebreak}` 和 `{image:...}`；
- 直接输 `gold`、`bold`、`reset`、`page`、`img` 也能补全。

`Tab` 接受补全或跳到下一个片段字段，`Shift-Tab` 回退，`Esc` 关闭。补全打开时 `Enter` 接受，否则正常换行。补全和片段之外，`Tab` 仍然是浏览器的焦点切换。右上角「语法补全」可以手动打开列表，不依赖 `Ctrl+Space`，避免和中文输入法打架。

`Ctrl+S` / `Cmd+S` 保存并阻止浏览器保存网页，不会开启自动保存。中间的分隔条可以拖，也可以聚焦后用方向键 / Home / End 调。

### 保存、冲突和恢复

保存前服务器会校验文件版本，把原文件按相对路径备份到 `.quest-preview-backups/<时间戳>-<随机串>/`，页面会显示这次备份的位置。多个文件一起保存时，任一文件失败会尽量回滚。保存后预览自动刷新；游戏里有没有更新取决于 FTB Quests 自己的重载行为，这个工具不会给游戏发命令。

如果页面打开后文件被别的程序改了，保存会返回 409，草稿保留。先确认外部改动，点「放弃更改 / 重新载入」，再重做修改。

恢复时停掉服务，打开对应备份批次的 `manifest.json`：`originalExists: true` 的文件复制回原位；`false` 的（通常是新建的语言文件）删掉那次创建的文件。备份不会自动清理。

## 命令行

`ftbquest` 不带参数启动预览；带命令时走 headless CLI，适合脚本和 AI。读写复用同一套 parser、备份和冲突检测，默认 dry-run。

```sh
ftbquest list --json --brief
ftbquest show demo_first --json
ftbquest search "钢" --in title,description --json
ftbquest lint --json --strict
ftbquest patch --file patch.json --json          # dry-run
ftbquest patch --file patch.json --apply --json  # 写入
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `list` | 列章节和任务，`--brief` 只给 ID、标题、章节、坐标 |
| `show <id>` | 看一个任务，`--raw` 附原始 SNBT |
| `deps <id>` | 依赖和反向依赖，`--direction`、`--depth` |
| `search <q>` | 搜任务，`--in` 指定字段 |
| `lint` | 查重复 ID、坏依赖、非法坐标等，`--strict` 有错时退出 1 |
| `schema` | 输出字段模型和 patch 限制 |
| `skill` | 打印 AI 使用说明；`skill install` 装到 agent 目录 |
| `patch --file` | 应用 JSON patch，默认 dry-run，`--apply` 才写 |

`--locale` 默认 `en_us`，中文包显式传 `--locale zh_cn`。patch 里的 `locale` 优先级更高，同时决定读和写。

patch 长这样：

```json
{
  "locale": "zh_cn",
  "edits": [
    { "questId": "ABC123", "x": 1.5, "y": -1, "title": "新标题", "description": ["第一行", "第二行"] }
  ]
}
```

可写字段是 `x`、`y`、`title`、`subtitle`、`description`。dry-run 返回文件、行号和 diff，不写盘；`--apply` 才落盘并生成备份。重复执行同一个 patch 是幂等的；文件被外部改过会返回 `conflict`，重新读一遍再做，不要盲重试。`--json` 统一输出 `{ ok, command, ... }`。

`ftbquest skill install` 会装一份 agent 说明到 `~/.agents/skills/ftbquests`，也可以用 `--target` 指定目录。已有内容不同或带定制文件的目录不会被覆盖；旧命令 `ftbquest install-skill` 仍然可用。

## 兼容性和限制

在 Minecraft 1.21.1 + FTB Quests 2101.1.26 上实际验证过。SNBT parser 只覆盖这个版本里用到的结构，不是通用 NBT 实现；其他版本没声明兼容。

渲染是近似：读取本机 Minecraft 的 ASCII 字形和 Unihex 资源，缺资源时用浏览器字体；支持常见的 `&` 格式码、独占一行的 `{@pagebreak}` 和单行 `{image:...}`，但不是完整的 FTB Quests 描述渲染器。任务和奖励显示为紧凑摘要，不是 3D 物品；章节 `images` 暂时不绘制。

## 常见问题

**`chapters/` 找不到**：`--data-dir` 要指向 quests 根目录（里面直接有 `chapters/`），不是上一级。

**端口 4173 被占用**：用 `QUEST_PREVIEW_PORT` 换端口。

**保存后游戏里没变化**：这个工具只改文件，让 FTB Quests 重新加载任务数据。

**中文变方块**：实例没选对或资源缺失时会退回浏览器字体，保存不受影响。

**想重置 demo**：关掉服务，删 `.local/demo-quests/`，下次启动会从 `fixtures/quests` 重新复制。

## 开发

```sh
npm run build   # 生成编辑器 bundle
npm run check   # 所有 js/mjs 语法检查
npm test        # 含 jsdom 下的真实 CodeMirror 测试
```

`prepack` 会在 `npm pack` / `npm publish` 前自动重建 bundle，并把第三方许可证写进 `editor-assets/LICENSES.txt`。

## English quick start

Requires Node.js 20+.

```sh
npm install -g ftb-quests-preview
ftbquest
```

On first run, pick a Minecraft instance, a quests folder containing `chapters/`, or the bundled demo. The same binary has a headless CLI:

```sh
ftbquest list --data-dir "PATH/TO/quests" --json --brief
ftbquest lint --json --strict
ftbquest patch --file patch.json --json          # dry-run
ftbquest patch --file patch.json --apply --json  # write
```

## License

MIT，见 [LICENSE](LICENSE)。Minecraft、FTB Quests、模组和资源包不随项目分发，也不在许可证覆盖范围内。

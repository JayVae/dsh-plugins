# dsh-client-opencode-trace-viewer

在 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) Web UI 中查看 [OpenCode](https://opencode.ai) 会话轨迹（trajectory view）的客户端插件。与姊妹插件 `dsh-client-codex-trace-viewer` 界面与功能一致，数据源不同。

侧边栏底部（以及会话页头部）会出现 **🌀 OpenCode Traces** 按钮，打开独立的轨迹查看器：按项目目录分组的会话列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、类型过滤与会话内搜索。

## 支持版本

| 依赖 | 版本要求 |
| --- | --- |
| dsh（`@deepseek-ai/dsh`） | `^0.2.1-rc.2`（经 `engines.dsh` 声明，安装时由插件管理器校验） |
| Node.js | `>= 22`（转换脚本依赖 `node:sqlite`，该模块在 Node 22 中可用） |
| OpenCode | 会话数据来自 OpenCode 本地 SQLite 数据库（2025 年 storage v1 格式） |

## 前置依赖

- 已安装并使用过 dsh：`npm i -g @deepseek-ai/dsh`（需要 Node 22+）
- 本机存在 OpenCode 会话数据库：
  - Linux / macOS：`~/.local/share/opencode/opencode.db`
  - Windows：`C:\Users\<you>\.local\share\opencode\opencode.db`（或通过环境变量 `OPENCODE_DB` 指定任意路径）

## 安装

通过 dsh 官方插件管理命令安装（内部转发给 pnpm）：

```sh
dsh plugin --profile web add dsh-client-opencode-trace-viewer
```

或直接从包含多个插件的 GitHub 仓库安装：

```sh
dsh plugin --profile web add github:<github-user>/dsh-plugins --filter dsh-client-opencode-trace-viewer
```

也可以手动方式（等价于上面第一条）：

```sh
cd ~/.dsh/profiles/web
pnpm add dsh-client-opencode-trace-viewer
```

安装后在 profile 的 `cordis.patch.yml` 中启用：

```yaml
- insert:
    - id: opencode-trace-viewer
      name: dsh-client-opencode-trace-viewer
```

重启 dsh（`dsh web`）后生效。若使用 `dsh plugin add`，启用步骤通常已自动完成。

## 使用

1. 生成轨迹数据（只读打开 `opencode.db`，输出内联进插件 bundle）。在插件包目录内执行：

   ```sh
   node scripts/convert.mjs            # 默认数据库路径
   OPENCODE_DB=/path/to/opencode.db node scripts/convert.mjs   # 自定义路径
   node scripts/build.mjs
   ```

2. 打开 dsh Web UI，点击侧边栏底部 **🌀 OpenCode Traces**。

> 说明：轨迹数据在转换时快照进 bundle，不会自动跟随新会话更新；需要最新数据时重新执行第 1 步并重启 dsh。数据库以只读模式打开，插件不发起任何网络请求，数据完全留在本机。

## 功能

与 `dsh-client-codex-trace-viewer` 一致：

- 会话列表：按项目目录折叠分组，显示原生会话标题、日期、事件数
- 轮次瀑布流时间轴：turns 主泳道 + reply / tool / think / other 子泳道，按事件序号定位（空闲间隔不占宽度）
- minimap 滚动条：canvas 分桶绘制的全时段概览，拖动平移、点击居中、shift+滚轮缩放、双击重置
- 轮次阅读视图：用户输入 → 折叠的"中间过程"区（分类计数：🔧 工具 / 🤔 思考 / 💬 输出）→ 最终结果，点击瘦行展开输入输出明细
- 点击跳转：时间轴刻度/轮次条 → 自动展开目标轮次、滚动定位（避开固定时间轴）并高亮
- 类型过滤与会话内搜索；token 与费用显示在轮次头部；模型 id 显示在会话信息栏

## 与 Codex 版的数据差异

- OpenCode 无独立 system 消息存储，因此不含 Codex 版可见的系统提示/技能清单内容
- token 数据来自 `step-finish` part（input / output / reasoning / cache / cost），粒度到每步
- 部分 part 类型（`step-start`、`agent`、`compaction`）为结构信息，默认不展示

## 开发

```sh
pnpm install
node scripts/convert.mjs   # opencode.db → lib/assets/traces.json
node scripts/build.mjs     # src/client-main.js + traces.json → lib/client.js
```

- `src/client-main.js` 是唯一需要编辑的 UI 源码；`lib/client.js` 为构建产物，请勿直接修改
- 构建用 `String.replace` 注入 JSON 时必须使用函数形式，否则 JSON 中的 `$&`、`$'` 序列会被吞掉
- 插件槽位：`sidebar.footer.action`、`conversation.session.header.actions`（dsh 0.2.1-rc.2 验证可用）

## 已知限制

- 轨迹为静态快照，不实时跟随新会话（实时流需要 host 侧配合，计划中）
- 单会话事件上限 4000 条、单条文本截断 4000 字符、最多 80 个会话（防止 bundle 过大）

## License

MIT

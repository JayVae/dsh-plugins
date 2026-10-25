# dsh-client-codex-trace-viewer

在 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) Web UI 中查看 [Codex CLI](https://developers.openai.com/codex/) 会话轨迹（trajectory view）的客户端插件。

侧边栏底部（以及会话页头部）会出现 **🧭 Codex Traces** 按钮，打开独立的轨迹查看器：按项目目录分组的会话列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、类型过滤与会话内搜索。

## 支持版本

| 依赖 | 版本要求 |
| --- | --- |
| dsh（`@deepseek-ai/dsh`） | `^0.2.1-rc.2`（经 `engines.dsh` 声明，安装时由插件管理器校验） |
| Node.js | `>= 22`（与 dsh 运行时要求一致） |
| Codex CLI | 会话数据来自 `~/.codex/sessions/**/*.jsonl`（rollout 格式，2025 年起的版本均可） |

## 前置依赖

- 已安装并使用过 dsh：`npm i -g @deepseek-ai/dsh`（需要 Node 22+）
- 本机存在 Codex 会话数据：`~/.codex/sessions/`（Windows 为 `C:\Users\<you>\.codex\sessions\`）

## 安装

通过 dsh 官方插件管理命令安装（内部转发给 pnpm）：

```sh
dsh plugin --profile web add dsh-client-codex-trace-viewer
```

或直接从包含多个插件的 GitHub 仓库安装：

```sh
dsh plugin --profile web add github:JayVae/dsh-plugins --filter dsh-client-codex-trace-viewer
```

也可以手动方式（等价于上面第一条）：

```sh
cd ~/.dsh/profiles/web
pnpm add dsh-client-codex-trace-viewer
```

安装后在 profile 的 `cordis.patch.yml` 中启用：

```yaml
- insert:
    - id: codex-trace-viewer
      name: dsh-client-codex-trace-viewer
```

重启 dsh（`dsh web`）后生效。若使用 `dsh plugin add`，启用步骤通常已自动完成。

## 使用

1. 生成轨迹数据（读取本机 Codex 会话，输出内联进插件 bundle）。在插件包目录内执行：

   ```sh
   npx --yes github:JayVae/dsh-plugins --prefix dsh-client-codex-trace-viewer
   ```

   或克隆仓库后：`node scripts/convert.mjs && node scripts/build.mjs`

2. 打开 dsh Web UI，点击侧边栏底部 **🧭 Codex Traces**。

> 说明：轨迹数据在转换时快照进 bundle，不会自动跟随新会话更新；需要最新数据时重新执行第 1 步并重启 dsh。数据完全留在本机，插件不发起任何网络请求。

## 功能

- 会话列表：按项目目录折叠分组，显示标题、日期、事件数
- 轮次瀑布流时间轴：turns 主泳道 + reply / tool / think / other 子泳道，按事件序号定位（空闲间隔不占宽度）
- minimap 滚动条：canvas 分桶绘制的全时段概览，拖动平移、点击居中、shift+滚轮缩放、双击重置
- 轮次阅读视图：用户输入 → 折叠的"中间过程"区（分类计数：🔧 工具 / 🤔 思考 / 💬 输出）→ 最终结果，点击瘦行展开输入输出明细
- 点击跳转：时间轴刻度/轮次条 → 自动展开目标轮次、滚动定位（避开固定时间轴）并高亮
- 类型过滤与会话内搜索；token 用量显示在轮次头部

## 开发

```sh
pnpm install
node scripts/convert.mjs   # ~/.codex/sessions → lib/assets/traces.json
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

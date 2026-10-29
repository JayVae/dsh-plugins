# dsh-client-codex-trace-viewer

在 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) Web UI 中查看 [Codex CLI](https://developers.openai.com/codex/) 会话轨迹（trajectory view）的插件（客户端 + host 服务端各半）。

侧边栏底部会出现 **🧭 Codex Traces** 按钮，打开独立的轨迹查看器：按项目目录分组的会话列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、类型过滤与会话内搜索。

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

1. 打开 dsh Web UI，点击侧边栏底部 **🧭 Codex Traces**。

2. 首次打开时列表为空，点查看器左上角的 **⟳ 更新数据**。host 侧（`lib/index.js`）会在这台机器上
   运行一次 `scripts/convert.mjs`，把 `~/.codex/sessions/` 的会话转换到 `lib/assets/traces.json`，
   然后自动重新加载列表——**不需要终端、不需要重建、不需要重启 dsh**。

> 之后想看最新会话，随时再点一次 **⟳ 更新数据** 即可（同一个按钮同时覆盖首次生成和后续更新）。
> 轨迹数据不打包进 bundle：host 在 `/.dsh-codex-trace-viewer/traces` 路由上每次请求实时读盘返回。
> 数据完全留在本机，插件不访问任何外部网络资源（fetch 仅指向本机 dsh 路由）。

### 可选：命令行方式

正常使用不需要命令行。只有两种情况会用到 `node scripts/convert.mjs [--out <dir>]`：

- 想在无浏览器的机器上预生成数据；
- 排查问题时想直接看转换输出。

## 功能

- 一键更新：侧边栏 **⟳ 更新数据** 按钮直接在本机重跑转换并刷新列表，无需命令行
- 会话列表：按项目目录折叠分组，显示标题、日期、事件数
- 轮次瀑布流时间轴：turns 主泳道 + reply / tool / think / other 子泳道，按事件序号定位（空闲间隔不占宽度）
- minimap 滚动条：canvas 分桶绘制的全时段概览，拖动平移、点击居中、shift+滚轮缩放、双击重置
- 轮次阅读视图：用户输入 → 折叠的"中间过程"区（分类计数：🔧 工具 / 🤔 思考 / 💬 输出）→ 最终结果，点击瘦行展开输入输出明细
- 点击跳转：时间轴刻度/轮次条 → 自动展开目标轮次、滚动定位（避开固定时间轴）并高亮
- 类型过滤与会话内搜索；token 用量显示在轮次头部

## 开发

```sh
pnpm install
node scripts/convert.mjs   # ~/.codex/sessions → lib/assets/traces.json（默认写到包内）
node scripts/build.mjs     # src/client-main.js → lib/client.js（不含数据）
node scripts/smoke.mjs     # 冒烟测试「⟳ 更新数据」按钮的请求链路（无需浏览器）
```

- `src/client-main.js` 是唯一需要编辑的 UI 源码；`lib/client.js` 为构建产物，请勿直接修改
- `lib/index.js` 是 host 侧，注册两条路由：
  - `GET /.dsh-codex-trace-viewer/traces` — 每次请求实时读盘返回 `lib/assets/traces.json`
  - `POST /.dsh-codex-trace-viewer/refresh` — 在本机 spawn `scripts/convert.mjs --out lib/assets`，
    返回 `{ ok, stdout, stderr, data }`；要求 `x-dsh-trace-refresh: 1` 请求头（跨站请求无法携带
    自定义头而不触发 CORS 预检，以此挡住 CSRF），同一时刻只跑一个转换
- 构建脚本会对 `//# sourceMappingURL=` / `//# sourceURL=` 序列做 `\u0023` 中和（见
  [docs/dsh-upstream-bundle-trailer-truncation.md](../docs/dsh-upstream-bundle-trailer-truncation.md)），
  防止 DSH 服务端剥离 trailer 的正则在单行 bundle 中误匹配数据文本并把文件截断
- 插件槽位：`sidebar.footer.action`（dsh 0.2.1-rc.2 验证可用）

## 已知限制

- 轨迹数据按转换时的快照服务（host 每请求实时读盘）；新会话需点一次 **⟳ 更新数据**，自动增量转换计划中
- 「更新数据」按钮依赖 dsh 的 `webServer` 服务；若该服务不可用，查看器会提示改用命令行
- 单会话事件上限 4000 条、单条文本截断 4000 字符、最多 80 个会话

## License

MIT

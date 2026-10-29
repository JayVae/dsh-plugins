# dsh-client-opencode-trace-viewer

在 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) Web UI 中查看 [OpenCode](https://opencode.ai) 会话轨迹（trajectory view）的插件（客户端 + host 服务端各半）。与姊妹插件 `dsh-client-codex-trace-viewer` 界面与功能一致，数据源不同。

侧边栏底部会出现 **🌀 OpenCode Traces** 按钮，打开独立的轨迹查看器：按项目目录分组的会话列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、类型过滤与会话内搜索。

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
dsh plugin --profile web add github:JayVae/dsh-plugins --filter dsh-client-opencode-trace-viewer
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

1. 打开 dsh Web UI，点击侧边栏底部 **🌀 OpenCode Traces**。

2. 首次打开时目录列表为空，点查看器左上角的 **⟳ 更新数据**。host 侧（`lib/index.js`）会在这台机器上
   以只读方式打开 `opencode.db` 并运行一次 `scripts/convert.mjs`，把会话按项目目录分片写到
   `lib/assets/`，然后自动重新加载目录列表——**不需要终端、不需要重建、不需要重启 dsh**。

3. **先选目录，再选会话**：左侧只显示目录清单（项目名 + 会话数 + 体积），点进去才加载该目录的会话列表，
   点某个会话才加载它的事件。这样打开查看器的开销与会话历史长短无关，不会再出现整包下载十几 MB 的情况。

> 之后想看最新会话，随时再点一次 **⟳ 更新数据** 即可（同一个按钮同时覆盖首次生成和后续更新）。
> 上次打开的目录会被记住，下次打开直接回到它（只重新拉那一个目录的列表）。
> 轨迹数据不打包进 bundle：host 在 `/.dsh-opencode-trace-viewer/index`、`/sessions`、`/session` 三条路由上
> 每次请求实时读盘返回。数据库以只读模式打开，数据完全留在本机；插件不访问任何外部网络资源（fetch 仅指向本机 dsh 路由）。

### 可选：命令行方式

正常使用不需要命令行。只有这些情况会用到 `node scripts/convert.mjs [--out <dir>]`：

- 想在无浏览器的机器上预生成数据；
- 数据库不在默认路径，需要 `OPENCODE_DB=/path/to/opencode.db node scripts/convert.mjs`；
- 排查问题时想直接看转换输出。

## 功能

与 `dsh-client-codex-trace-viewer` 一致：

- 一键更新：侧边栏 **⟳ 更新数据** 按钮直接在本机重跑转换并刷新列表，无需命令行
- 目录优先 + 按需加载：目录清单（几 KB）→ 单目录会话列表 → 单会话事件，逐层加载，历史再长也不拖慢打开速度
- 会话列表：显示原生会话标题、日期、事件数、体积；顶部输入框可过滤目录或会话
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
node scripts/convert.mjs   # opencode.db → lib/assets/{index.json,dirs,sessions}（默认写到包内）
node scripts/build.mjs     # src/client-main.js → lib/client.js（不含数据）
node scripts/smoke.mjs     # 冒烟测试：index → 目录 → 会话 → 更新，验证按需加载与请求头（无需浏览器）
```

- `src/client-main.js` 是唯一需要编辑的 UI 源码；`lib/client.js` 为构建产物，请勿直接修改
  （本包与 Codex 版共用实现：改 Codex 版后运行仓库根目录的 `node scripts/sync-opencode.mjs` 同步）
- `lib/index.js` 是 host 侧，注册四条路由：
  - `GET /.dsh-opencode-trace-viewer/index` — 目录清单（`lib/assets/index.json`）
  - `GET /.dsh-opencode-trace-viewer/sessions?dir=<dirKey>` — 单目录的会话列表（`lib/assets/dirs/`）
  - `GET /.dsh-opencode-trace-viewer/session?dir=<dirKey>&file=<file>` — 单会话的事件（`lib/assets/sessions/`）
  - `POST /.dsh-opencode-trace-viewer/refresh` — 在本机 spawn `scripts/convert.mjs --out lib/assets`，
    返回 `{ ok, stdout, stderr, data }`；要求 `x-dsh-trace-refresh: 1` 请求头（跨站请求无法携带
    自定义头而不触发 CORS 预检，以此挡住 CSRF），同一时刻只跑一个转换
- 分片文件名是 sha1 摘要（`dirKey` / `file` 均校验为 12 位十六进制），路径穿越在路由层就被拒绝
- 构建脚本会对 `//# sourceMappingURL=` / `//# sourceURL=` 序列做 `\u0023` 中和（见
  [docs/dsh-upstream-bundle-trailer-truncation.md](../docs/dsh-upstream-bundle-trailer-truncation.md)），
  防止 DSH 服务端剥离 trailer 的正则在单行 bundle 中误匹配数据文本并把文件截断
- 插件槽位：`sidebar.footer.action`（dsh 0.2.1-rc.2 验证可用）

## 已知限制

- 轨迹数据按转换时的快照服务（host 每请求实时读盘）；新会话需点一次 **⟳ 更新数据**，自动增量转换计划中
- 首次进入某个目录、点开某个会话各有一次本地请求（通常 1–60 KB），换来的是打开查看器只花几 KB
- 「更新数据」按钮依赖 dsh 的 `webServer` 服务；若该服务不可用，查看器会提示改用命令行
- 转换由 host 进程 spawn 子进程执行，需要 `node:sqlite`（Node 22+）
- 单会话事件上限 4000 条、单条文本截断 4000 字符、最多 80 个会话

## License

MIT

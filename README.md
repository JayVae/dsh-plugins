# dsh-plugins

[DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 客户端插件合集。

| 插件 | npm 包 | 说明 |
| --- | --- | --- |
| [codex-trace-viewer](./codex-trace-viewer/) | [`dsh-client-codex-trace-viewer`](https://www.npmjs.com/package/dsh-client-codex-trace-viewer) | 在 dsh Web UI 中查看 Codex CLI 会话轨迹 |
| [opencode-trace-viewer](./opencode-trace-viewer/) | [`dsh-client-opencode-trace-viewer`](https://www.npmjs.com/package/dsh-client-opencode-trace-viewer) | 在 dsh Web UI 中查看 OpenCode 会话轨迹 |

两个插件界面与功能一致（会话分组列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、搜索过滤），数据源不同：前者读取 `~/.codex/sessions/`，后者读取 OpenCode 的 SQLite 数据库。

## 安装

```sh
# Codex
dsh plugin --profile web add dsh-client-codex-trace-viewer

# OpenCode
dsh plugin --profile web add dsh-client-opencode-trace-viewer
```

详细的使用说明、版本要求与数据转换步骤见各插件目录下的 README。

> 注意：插件 bundle 不含任何会话数据。安装后需要在本机执行一次数据转换（各插件 README 的"使用"一节），把 `traces.json` 写到已安装副本的 `lib/assets/` 下；host 侧路由会在每次请求时实时读取该文件，之后更新数据只需重跑转换脚本 + 刷新浏览器，无需重建或重启。

## 数据流

```
codex/opencode 会话数据 ──convert.mjs──▶ lib/assets/traces.json（已安装副本内）
                                              │
浏览器查看器 ◀──运行时 fetch── host 侧路由（lib/index.js，每次请求实时读盘）
```

## 已知上游问题

dsh 0.2.1-rc.2 的 `dsh-client-modules` 在下发 bundle 时剥离 trailer 的正则会误匹配单行
bundle 中数据文本里的 `//# sourceMappingURL=` 并把文件截断（本仓库曾因此踩坑）。
详见 [docs/dsh-upstream-bundle-trailer-truncation.md](./docs/dsh-upstream-bundle-trailer-truncation.md)；
构建脚本已对该 marker 序列做 `\u0023` 中和规避。

## License

MIT

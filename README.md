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

> 注意：插件 bundle 不含任何会话数据。安装后需要在本机执行一次数据转换（各插件 README 的"使用"一节），把你的会话快照构建进本地 bundle。

## License

MIT

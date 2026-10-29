# dsh-plugins

[DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 客户端插件合集。

| 插件 | npm 包 | 说明 |
| --- | --- | --- |
| [codex-trace-viewer](./codex-trace-viewer/) | [`dsh-client-codex-trace-viewer`](https://www.npmjs.com/package/dsh-client-codex-trace-viewer) | 在 dsh Web UI 中查看 Codex CLI 会话轨迹 |
| [opencode-trace-viewer](./opencode-trace-viewer/) | [`dsh-client-opencode-trace-viewer`](https://www.npmjs.com/package/dsh-client-opencode-trace-viewer) | 在 dsh Web UI 中查看 OpenCode 会话轨迹 |
| [session-delete](./session-delete/) | [`dsh-session-delete-plugin`](https://www.npmjs.com/package/dsh-session-delete-plugin) | 在侧边栏对话「…」菜单中彻底删除对话的本地记录 |

所有插件均为 dsh 客户端插件（`dsh.client` 双面结构：`lib/client.js` 浏览器端 + `lib/index.js` 宿主端），
要求 dsh `0.2.1-rc.2` 及以上、Node.js 22+，详细的使用说明与版本要求见各插件目录下的 README。

## 安装

```sh
# Codex 轨迹查看器
dsh plugin --profile web add dsh-client-codex-trace-viewer

# OpenCode 轨迹查看器
dsh plugin --profile web add dsh-client-opencode-trace-viewer

# 会话删除
dsh plugin --profile web add dsh-session-delete-plugin
```

安装后需要在 `~/.dsh/profiles/web/cordis.patch.yml` 中用 insert 条目启用（`dsh plugin add` 会自动写入；
手动安装见各插件 README），配置 HMR 自动重载后刷新浏览器页面。

## codex-trace-viewer / opencode-trace-viewer

两个插件界面与功能一致（目录优先的会话列表、轮次瀑布流时间轴、调用链阅读视图、minimap 平移缩放、
搜索过滤），数据源不同：前者读取 `~/.codex/sessions/`，后者读取 OpenCode 的 SQLite 数据库。

> 注意：插件 bundle 不含任何会话数据。安装后打开查看器，点左上角 **⟳ 更新数据** 即可生成；
> host 侧会在这台机器上运行转换脚本，把结果按目录分片写到已安装副本的 `lib/assets/`，
> 之后每次点击都会重新扫描并刷新——无需终端、无需重建、无需重启 dsh。

### 数据流

```
                          ┌── 查看器「⟳ 更新数据」按钮 (POST /refresh)
                          ▼
codex/opencode 会话数据 ──convert.mjs──▶ lib/assets/
                                          ├─ index.json                     目录清单（几 KB）
                                          ├─ dirs/<dirKey>.json             单目录的会话列表
                                          └─ sessions/<dirKey>/<id>.json    单个会话的事件
                                              │
浏览器查看器 ◀──按需 fetch── host 侧路由（lib/index.js，每次请求实时读盘）
```

打开查看器只拉 `index.json`（几 KB，随会话**数量**增长，不随对话**长度**增长）；选中目录后才拉该目录的
会话列表；选中会话后才拉事件。一次点击的完整链路：按钮 → `POST /.dsh-<pkg>/refresh` → host 在本机
spawn `scripts/convert.mjs` → 重写分片 → 返回转换摘要 → 查看器重新 `GET /index`。

## session-delete

在侧边栏每个对话的「…」菜单末尾加**删除对话（本地记录）**项，确认后由宿主端一次性删除该对话的：

- 会话日志目录 `~/.dsh/sessions/<项目目录>/<会话id>/`；
- 投影缓存 `~/.dsh/storages/session_projcache/sessions/<会话id>.json`；
- 工作区注册表记账（所属工作区 `sessionIds`、全局置顶、全局归档集合）。

随后广播 `api-session/removed`，所有已打开页面立即移除该行，全文搜索索引在下次对账时自动遗忘。
正在使用中的对话会拒绝删除（HTTP 409）；操作明细追加写入 `~/.dsh/session-delete.log`。

运行时激活/停用、从源码安装与修改、卸载等说明见 [session-delete/README.md](./session-delete/README.md)。

## 发布（维护者）

各插件独立发 npm：改代码 → bump `package.json` 版本 → 在插件目录 `npm publish`
（session-delete 的 `publishConfig` 已固定官方源，不受本地镜像影响）→ 提交并推送。

## 已知上游问题

dsh 0.2.1-rc.2 的 `dsh-client-modules` 在下发 bundle 时剥离 trailer 的正则会误匹配单行
bundle 中数据文本里的 `//# sourceMappingURL=` 并把文件截断（本仓库曾因此踩坑）。
详见 [docs/dsh-upstream-bundle-trailer-truncation.md](./docs/dsh-upstream-bundle-trailer-truncation.md)；
构建脚本已对该 marker 序列做 `\u0023` 中和规避。

## License

MIT

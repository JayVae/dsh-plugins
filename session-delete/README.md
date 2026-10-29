# dsh-session-delete-plugin

在 DeepSeek Harness（dsh）Web 侧边栏每个对话的「…」菜单里增加**删除对话（本地记录）**选项：确认后彻底删除该对话在本机的全部记录。

## 行为

- 菜单项位于会话「…」菜单末尾（置顶 / 重命名 / 复刻 / 归档 / 复制 ID 之后）。
- 点击后弹出确认对话框；确认后宿主端删除：
  1. 会话日志目录 `~/.dsh/sessions/<项目目录>/<会话id>/`；
  2. 投影缓存 `~/.dsh/storages/session_projcache/sessions/<会话id>.json`；
  3. 工作区注册表中的记账（从所属工作区的 `sessionIds`、全局置顶、全局归档集合中移除）；
  4. 随后广播 `api-session/removed`，所有已打开的页面立即移除该行；全文搜索索引会在下次对账时自动遗忘该会话。
- 正在使用的对话（当前打开/运行中）会被拒绝（HTTP 409），提示先切换到其他对话。
- 只删除该对话的记录，不删除工作区目录，也不触碰 DSH home 之外任何文件。
- 每次删除的明细（目录、缓存、记账清理）都追加写入 `~/.dsh/session-delete.log`，可随时审计。

## 安装（web profile）

```sh
dsh plugin --profile web add dsh-session-delete-plugin
```

或手动安装：

1. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加入：
   ```json
   "dsh-session-delete-plugin": "^0.1.0"
   ```
   然后在该目录执行 `pnpm install`。
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 顶部（与其他 insert 同级）加入：
   ```yaml
   - insert:
       - id: session-delete
         name: 'dsh-session-delete-plugin'
   ```
3. 配置 HMR 会自动重载（或重启 `dsh web`），刷新浏览器页面即可看到菜单项。

## 运行时激活 / 停用

开关就是 `cordis.patch.yml` 里上面那个 insert 条目，改动保存即触发配置 HMR 自动重载，无需重启 `dsh web`（浏览器需刷新一次页面）：

- **停用**：删除或注释掉 `- id: session-delete` / `name:` 两行 → 宿主路由和菜单项一起消失。
- **重新激活**：恢复这两行即可（node_modules 里的拷贝还在，无需重新安装）。

## 从源码安装 / 修改

注意 `pnpm` 对 `file:` 依赖是**拷贝不是链接**：运行时读的是 `~/.dsh/profiles/web/node_modules/dsh-session-delete-plugin/` 里的副本。

1. 在 profile 的 `package.json` 里用本地路径：
   ```json
   "dsh-session-delete-plugin": "file:<本仓库>/session-delete"
   ```
2. 每次修改源码后，在 `~/.dsh/profiles/web` 下重新执行 `pnpm install` 刷新副本。
3. 改动 `cordis.patch.yml`（如加个注释）触发 HMR 重载，刷新页面。

## 卸载

从 `cordis.patch.yml` 删除 insert 条目、从 `package.json` 删除依赖并 `pnpm install`；之后才可删除本目录源码。

## 实现

- `lib/client.js`：向 `sidebar.workspaces.session.menu.item`（order 475）注册菜单项，确认对话框挂在 `shell.overlay`（内置重命名/归档对话框同一模式）。
- `lib/index.js`：`ctx.inject(["webServer"], ...)` 等服务就绪后注册 `POST /.dsh-session-delete/delete` 路由；删除流程见上文「行为」。
- 无构建步骤，`lib/*.js` 为手写产物（区别于本仓库其他插件的 src → build 流程，`.gitignore` 已为它开例外）。

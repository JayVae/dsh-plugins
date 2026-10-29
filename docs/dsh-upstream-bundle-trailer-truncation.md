# Upstream bug report draft: dsh-client-modules trailer stripping truncates bundles containing `//# sourceMappingURL=` mid-file

> Status: draft, ready to file against `@deepseek-ai/dsh` / `@deepseek-ai/dsh-client-modules` (observed on dsh 0.2.1-rc.2).
> 中文摘要见文末。

## Summary

`dsh-client-modules/lib/index.js` strips bundle trailers before serving plugin scripts:

```js
const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/;
const SOURCE_URL_TRAILER = /(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/;
// prepareSource():
source = source.replace(SOURCE_URL_TRAILER, "").replace(SOURCE_MAP_TRAILER, "");
```

Both patterns are anchored at `$` (end of input), but **not at a line start**. Because
`[^\r\n]*` may span any number of characters, the regex matches not only the real trailer
at the end of the file, but also **the first occurrence of `//# sourceMappingURL=` anywhere
in the last line of the bundle** — and replaces everything from there to the end of the file.

Any plugin bundle that is one long line (minified code, or a large embedded JSON payload)
and contains that marker text inside a string literal — e.g. trace/session viewers that
embed conversation transcripts, which routinely contain copied tool output — is silently
truncated at the marker.

## Observed failure (real case)

- Plugin `dsh-client-codex-trace-viewer` shipped a 12 MB lazy chunk
  `client.traces.js`: one line — `window.__ModuleLoader__.load({ id, chunk, factory })`
  with a 11.3 MB minified JSON payload of session transcripts.
- One transcript contained the literal text `//# sourceMappingURL=client.js.map`
  (copied tool output from an earlier session).
- Serving the chunk went through `prepareSource()`, which cut the response at that
  embedded marker (12,358,370 bytes on disk → 1,844,030 bytes served, with the
  synthetic `;` + fresh `//# sourceMappingURL=client.traces.js.map?rev=…` trailer
  still appended by `buildComboScript`).
- The cut landed inside a JSON string literal → the browser failed to parse the script
  (`SyntaxError: Invalid or unexpected token`) → nothing registered → the loader threw
  `client-modules: bundle … loaded without registering "…" via __ModuleLoader__.load`.
- Nothing on disk was corrupt: `node --check` passed on the file and failed on the served
  body. The failure was 100% reproducible through the running server and equally
  reproducible by running the two regexes on the file contents.

Reproduction sketch:

```js
const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/;
const bundle = `window.load({ data: "ok //# sourceMappingURL=fake.map still data" });`;
console.log(bundle.replace(SOURCE_MAP_TRAILER, ""));
// → window.load({ data: "ok          ← everything after the marker is gone
```

## Suggested fixes (either suffices)

1. Anchor the search to the **final line** instead of the whole string:

   ```js
   const lastNewline = source.lastIndexOf("\n");
   const head = source.slice(0, lastNewline + 1);
   const tail = source.slice(lastNewline + 1);
   source = head + tail.replace(SOURCE_URL_TRAILER, "").replace(SOURCE_MAP_TRAILER, "");
   ```

2. Or require the marker to start the line and disallow a huge tail, e.g.
   `/^\/\/# sourceMappingURL=[^\r\n]*$/m` applied only to the last matched line, or cap
   `[^\r\n]*` to something trailer-sized.

A regression test is straightforward: a bundle whose payload contains the marker text on
the same (only) line must survive `prepareSource()` byte-identical.

## Workaround used in the meantime

Third-party plugins can neutralize the marker inside their emitted string literals by
escaping one character: `//# sourceMappingURL=` → `//\u0023 sourceMappingURL=` (decodes to
the identical text at runtime, but breaks the regex's byte sequence). Both trace-viewer
plugins in this repository do this in their build scripts — this is a workaround, not a
fix; the host should not truncate valid bundles.

---

## 中文摘要

`dsh-client-modules` 在向浏览器下发插件 bundle 前，会用 `/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/`
剥离尾部的 sourcemap 注释。该正则只锚定了**结尾**，未锚定起点：当 bundle 是单行（压缩代码，
或内联的大 JSON 数据），且数据字符串里含有 `//# sourceMappingURL=` 字样（会话轨迹查看器嵌入的
对话记录里极易出现，比如复制的工具输出）时，正则会从**第一个嵌入 marker** 一直匹配到文件尾，
把 bundle 从该处截断。浏览器收到被切断的脚本后语法解析失败，表现为
`bundle … loaded without registering "…" via __ModuleLoader__.load`，且磁盘文件本身完好、
极难排查。修复建议：把剥离范围锚定到最后一行，或限制 marker 之后允许的长度；仓库内两个
trace-viewer 插件目前以「构建时把 marker 中的 `#` 写成 `\u0023`」规避。

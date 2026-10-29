#!/usr/bin/env node
// Convert OpenCode sessions (~/.local/share/opencode/opencode.db, SQLite)
// into the trace JSON consumed by the OpenCode Trace Viewer plugin.
//
// Storage model: session -> message (role/agent JSON) -> part (typed content
// JSON: text / reasoning / tool / patch / subtask / step-start / step-finish).
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.OPENCODE_DB || join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
const assetsDir = join(pkgDir, 'lib', 'assets')
// `--out <dir>` writes traces.json elsewhere — typically the installed copy's
// lib/assets under the DSH profile, so the running host companion serves the
// fresh data and a browser refresh shows new sessions without a rebuild.
const outArg = process.argv.indexOf('--out')
const outDir = outArg !== -1 && process.argv[outArg + 1] ? process.argv[outArg + 1] : assetsDir
const LIMIT_EVENTS = 4000
const LIMIT_TEXT = 4000
const MAX_TRACES = 80

if (!readFileSync(dbPath)) {
  console.error(`opencode.db not found at ${dbPath}; set OPENCODE_DB to override`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath, { readOnly: true })

function clip(text, limit = LIMIT_TEXT) {
  if (text == null) return ''
  const s = String(text)
  return s.length > limit ? s.slice(0, limit) + `\n… (${s.length - limit} more chars)` : s
}

function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function modelLabel(v) {
  // s.model is stored as JSON like {"id":"...","providerID":"...","variant":"..."}
  if (!v) return ''
  if (typeof v === 'object') return v.id || v.modelID || ''
  try {
    const o = JSON.parse(v)
    return (o && typeof o === 'object' && (o.id || o.modelID)) || v
  } catch { return v }
}

function folderOf(dir) {
  if (!dir) return '(no directory)'
  return dir.split(/[\\/]/).filter(Boolean).pop() || dir
}

const sessions = db.prepare(`
  SELECT s.id, s.title, s.directory, s.time_created, s.time_updated,
         s.agent, s.model, s.version, p.worktree
  FROM session s LEFT JOIN project p ON p.id = s.project_id
  ORDER BY s.time_updated DESC LIMIT ?
`).all(MAX_TRACES)

const getMessages = db.prepare(`SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created`)
const getParts = db.prepare(`SELECT data FROM part WHERE message_id = ? ORDER BY time_created`)

const traces = []
for (const s of sessions) {
  const trace = {
    id: s.id,
    // `name` is the field the viewer prefers (Codex rollouts emit it); `title`
    // stays for OpenCode-native tooling that reads the raw session row.
    name: s.title || '',
    title: s.title || '',
    date: fmtTime(s.time_created).slice(0, 10),
    updated: fmtTime(s.time_updated),
    directory: s.directory || s.worktree || '',
    folder: folderOf(s.directory || s.worktree),
    model: modelLabel(s.model),
    agent: s.agent || '',
    events: [],
  }
  // Turn grouping: a user message opens a turn; assistant parts belong to it.
  let turnSeq = 0
  const push = (kind, label, time, text, durMs, turnId) => {
    if (trace.events.length >= LIMIT_EVENTS) return
    const ev = { kind, label, time, text }
    if (durMs != null) ev.durMs = durMs
    if (turnId) ev.turn = turnId
    trace.events.push(ev)
  }

  for (const msg of getMessages.all(s.id)) {
    let m
    try { m = JSON.parse(msg.data) } catch { continue }
    const role = m.role === 'user' ? 'user' : 'assistant'
    if (role === 'user') turnSeq++
    const turnId = `t${turnSeq}`
    const agentTag = m.agent && m.agent !== 'build' ? ` (${m.agent})` : ''
    let parts
    try { parts = getParts.all(msg.id).map(r => { try { return JSON.parse(r.data) } catch { return null } }).filter(Boolean) } catch { parts = [] }
    for (const part of parts) {
      const t = fmtTime(part.time?.start || part.time?.end || msg.time_created)
      const add = (kind, label, text, durMs) => push(kind, label, t, text, durMs, turnId)
      if (part.type === 'text' && part.text?.trim()) {
        // First user text is a fallback title if session has none.
        add(role, role + agentTag, clip(part.text))
      } else if (part.type === 'reasoning' && part.text?.trim()) {
        add('reasoning', 'reasoning', clip(part.text))
      } else if (part.type === 'tool') {
        const st = part.state || {}
        const input = st.input ? JSON.stringify(st.input, null, 2) : ''
        const output = typeof st.output === 'string' ? st.output : st.output != null ? JSON.stringify(st.output, null, 2) : ''
        const dur = st.time?.start && st.time?.end ? st.time.end - st.time.start : null
        add('tool', `tool: ${part.tool}`, clip([input, output].filter(Boolean).join('\n--- output ---\n')), dur)
      } else if (part.type === 'step-finish' && part.tokens) {
        const tk = part.tokens
        add('tokens', 'tokens',
          `step: ${tk.input ?? '?'} in (${tk.cache?.read ?? 0} cached) / ${tk.output ?? '?'} out (${tk.reasoning ?? 0} reasoning)\n` +
          `total: ${tk.total ?? '?'}` + (part.cost ? `\ncost: $${part.cost}` : ''))
      } else if (part.type === 'patch') {
        add('patch', `patch (${(part.files || []).length} files)`, clip((part.files || []).join('\n')))
      } else if (part.type === 'subtask') {
        add('subtask', `subtask: ${part.agent || part.command || ''}`, clip(part.prompt || part.description || ''))
      }
      // step-start / step-finish / agent / compaction are structural noise here.
    }
  }

  if (trace.events.length > 1) traces.push(trace)
}

// ---- sharded output --------------------------------------------------------
// One file per session, one per directory, plus a small index:
//
//   <out>/index.json            every directory + counts      (a few KB)
//   <out>/dirs/<dirKey>.json    the sessions of one directory (a few KB)
//   <out>/sessions/<dirKey>/<sessionKey>.json   one session's events
//
// The viewer asks for a directory before it asks for sessions, so a history
// that keeps growing never turns into one huge download — the old single
// traces.json reached 12 MB and grew with every conversation.
function keyOf(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 12)
}

function stamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Newest timestamp a session knows about — event times beat the start date. */
function lastEventTime(trace) {
  for (let i = trace.events.length - 1; i >= 0; i--) if (trace.events[i].time) return trace.events[i].time
  return ''
}

function writeShards(outDir, traces) {
  const dirsDir = join(outDir, 'dirs')
  const sessionsDir = join(outDir, 'sessions')
  // Start clean: shards from an earlier run must not survive a refresh.
  rmSync(dirsDir, { recursive: true, force: true })
  rmSync(sessionsDir, { recursive: true, force: true })
  rmSync(join(outDir, 'traces.json'), { force: true })
  mkdirSync(dirsDir, { recursive: true })
  mkdirSync(sessionsDir, { recursive: true })

  const groups = new Map()
  for (const trace of traces) {
    const path = trace.cwd || trace.directory || ''
    const key = keyOf(path || '(no path)')
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        path,
        folder: trace.folder || path.split(/[\\/]/).filter(Boolean).pop() || '(no path)',
        sessions: [],
      })
    }
    groups.get(key).sessions.push(trace)
  }

  const dirs = []
  let totalEvents = 0
  let totalBytes = 0
  for (const group of groups.values()) {
    const folderDir = join(sessionsDir, group.key)
    mkdirSync(folderDir, { recursive: true })
    const entries = []
    let dirEvents = 0
    let dirBytes = 0
    // A resumed session can repeat an id; two shards must not share a filename
    // (one would silently overwrite the other), so ids are made unique.
    const usedIds = new Set()
    for (const trace of group.sessions) {
      let id = trace.id
      for (let n = 2; usedIds.has(id); n++) id = `${trace.id}-${n}`
      usedIds.add(id)
      trace.id = id
      const file = keyOf(id) + '.json'
      const body = JSON.stringify(trace)
      writeFileSync(join(folderDir, file), body)
      const bytes = Buffer.byteLength(body)
      const events = trace.events.length
      dirEvents += events
      dirBytes += bytes
      entries.push({
        id: trace.id,
        name: trace.name || trace.title || '',
        date: trace.date || '',
        updated: trace.updated || lastEventTime(trace),
        model: trace.model || '',
        events,
        bytes,
        file,
      })
    }
    entries.sort((a, b) => String(b.updated || b.date).localeCompare(String(a.updated || a.date)))
    writeFileSync(join(dirsDir, `${group.key}.json`),
      JSON.stringify({ key: group.key, path: group.path, folder: group.folder, sessions: entries }))
    dirs.push({
      key: group.key,
      path: group.path,
      folder: group.folder,
      sessions: entries.length,
      events: dirEvents,
      bytes: dirBytes,
      latest: entries.length ? entries[0].updated || entries[0].date : '',
      file: `${group.key}.json`,
    })
    totalEvents += dirEvents
    totalBytes += dirBytes
  }

  dirs.sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || a.folder.localeCompare(b.folder))
  const index = {
    version: 2,
    generatedAt: stamp(),
    totals: { dirs: dirs.length, sessions: traces.length, events: totalEvents, bytes: totalBytes },
    dirs,
  }
  // Written last: a half-finished run must never be advertised as the index.
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  return index
}

mkdirSync(outDir, { recursive: true })
const index = writeShards(outDir, traces)
console.log(`converted ${traces.length} opencode sessions (${index.totals.events} events) in ${index.totals.dirs} directories -> ${outDir}`)

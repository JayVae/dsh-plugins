#!/usr/bin/env node
// Convert Codex session rollouts (~/.codex/sessions/**/*.jsonl) into the
// trace JSON consumed by the Codex Trace Viewer plugin, then rebuild
// lib/client.js from src/client-main.js with the data inlined.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sessionsRoot = join(homedir(), '.codex', 'sessions')
const assetsDir = join(pkgDir, 'lib', 'assets')
// `--out <dir>` writes traces.json elsewhere — typically the installed copy's
// lib/assets under the DSH profile, so the running host companion serves the
// fresh data and a browser refresh shows new sessions without a rebuild.
const outArg = process.argv.indexOf('--out')
const outDir = outArg !== -1 && process.argv[outArg + 1] ? process.argv[outArg + 1] : assetsDir
const LIMIT_EVENTS = 4000
const LIMIT_TEXT = 4000
const MAX_TRACES = 80

function collectRollouts(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) collectRollouts(p, out)
    else if (entry.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function clip(text, limit = LIMIT_TEXT) {
  if (text == null) return ''
  const s = String(text)
  return s.length > limit ? s.slice(0, limit) + `\n… (${s.length - limit} more chars)` : s
}

function truncateArgs(args) {
  try {
    return clip(JSON.stringify(JSON.parse(args), null, 2))
  } catch {
    return clip(args)
  }
}

function titleFrom(text) {
  const line = String(text || '').split('\n').map(s => s.trim()).find(s => s.length > 0) || ''
  return line.length > 64 ? line.slice(0, 64) + '…' : line
}

function convertFile(path) {
  const meta = { id: '', name: '', title: '', date: '', cwd: '', folder: '', model: '', events: [] }
  const push = (kind, label, time, text) => {
    if (meta.events.length >= LIMIT_EVENTS) return
    meta.events.push({ kind, label, time, text })
  }
  // Pair function_call → function_call_output by call_id to compute durations.
  const callStart = new Map()
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 's' : n + 'ms'
  // Turn grouping: task_started opens a turn; subsequent events attach to it.
  let currentTurn = null
  let turnSeq = 0
  const pushT = (kind, label, time, text, extra) => {
    const before = meta.events.length
    push(kind, label, time, text)
    if (extra && meta.events.length > before) meta.events[meta.events.length - 1].turn = extra
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const t = o.timestamp ? o.timestamp.replace('T', ' ').slice(0, 19) : ''
    const p = o.payload || {}
    if (o.type === 'session_meta') {
      meta.id = p.id || basename(path, '.jsonl')
      meta.date = (p.timestamp || o.timestamp || '').slice(0, 10)
      meta.cwd = p.cwd || ''
      meta.folder = meta.cwd ? meta.cwd.split(/[\\/]/).filter(Boolean).pop() || '' : '(no cwd)'
      push('system', 'session', t, `cwd: ${p.cwd}\noriginator: ${p.originator}\ncli: ${p.cli_version}`)
    } else if (o.type === 'event_msg' && p.type === 'thread_settings_applied' && !meta.model) {
      meta.model = p.thread_settings?.model || ''
    } else if (o.type === 'event_msg' && p.type === 'task_started') {
      currentTurn = p.turn_id
      turnSeq++
      push('turn', `turn ${turnSeq}`, t, '')
    } else if (o.type === 'event_msg' && p.type === 'token_count') {
      const info = p.info || {}
      const total = info.total_token_usage || {}
      const last = info.last_token_usage || {}
      pushT('tokens', 'tokens', t,
        `last turn: ${last.input_tokens ?? '?'} in / ${last.output_tokens ?? '?'} out\n` +
        `cumulative: ${total.input_tokens ?? '?'} in (${total.cached_input_tokens ?? 0} cached) / ${total.output_tokens ?? '?'} out\n` +
        `total: ${total.total_tokens ?? '?'}`, currentTurn)
    } else if (o.type === 'response_item') {
      const turnAttr = p.internal_chat_message_metadata_passthrough?.turn_id || currentTurn
      if (p.type === 'message') {
        const role = p.role || 'assistant'
        const kind = role === 'user' ? 'user' : role === 'developer' || role === 'system' ? 'system' : 'assistant'
        const text = (p.content || []).map(c => c.text || '').join('\n')
        // First real user prompt becomes the session title (developer/system context excluded).
        if (kind === 'user' && !meta.title && text.trim() && !text.startsWith('<')) meta.title = titleFrom(text)
        pushT(kind, kind === 'system' ? role : kind, t, clip(text), turnAttr)
      } else if (p.type === 'reasoning') {
        const text = (p.summary || []).map(s => s.text || '').join('\n')
        if (text) pushT('reasoning', 'reasoning', t, clip(text), turnAttr)
      } else if (p.type === 'function_call') {
        pushT('tool', `tool: ${p.name}`, t, truncateArgs(p.arguments), turnAttr)
        if (p.call_id) callStart.set(p.call_id, Date.parse(t.replace(' ', 'T') + 'Z'))
      } else if (p.type === 'function_call_output') {
        const ev = { kind: 'tool_output', label: 'tool output', time: t, text: clip(typeof p.output === 'string' ? p.output : JSON.stringify(p.output)) }
        const start = callStart.get(p.call_id)
        if (start) {
          const end = Date.parse(t.replace(' ', 'T') + 'Z')
          ev.durMs = Math.max(end - start, 0)
        }
        if (turnAttr) ev.turn = turnAttr
        if (meta.events.length < LIMIT_EVENTS) meta.events.push(ev)
      } else if (p.type === 'tool_search_call') {
        pushT('tool', 'tool_search', t, truncateArgs(JSON.stringify(p.arguments || p)), turnAttr)
      } else if (p.type === 'tool_search_output') {
        pushT('tool_output', 'tool output', t, clip(JSON.stringify(p)), turnAttr)
      }
    }
    // token_count / task_started / item_completed are skipped: the view is
    // driven by response_item, which carries the conversation trajectory.
  }
  meta.name = meta.title || `${meta.date} ${meta.folder || meta.id.slice(0, 8)}`
  return meta
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
    // A resumed rollout can repeat a session id; two shards must not share a
    // filename (one would silently overwrite the other), so ids are made unique.
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

const rollouts = collectRollouts(sessionsRoot)
rollouts.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
const traces = rollouts.slice(0, MAX_TRACES).map(convertFile).filter(t => t.events.length > 1)
mkdirSync(outDir, { recursive: true })
const index = writeShards(outDir, traces)
console.log(`converted ${traces.length} traces (${index.totals.events} events) in ${index.totals.dirs} directories -> ${outDir}`)

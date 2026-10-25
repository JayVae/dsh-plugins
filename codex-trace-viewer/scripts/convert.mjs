#!/usr/bin/env node
// Convert Codex session rollouts (~/.codex/sessions/**/*.jsonl) into the
// trace JSON consumed by the Codex Trace Viewer plugin, then rebuild
// lib/client.js from src/client-main.js with the data inlined.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sessionsRoot = join(homedir(), '.codex', 'sessions')
const assetsDir = join(pkgDir, 'lib', 'assets')
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

const rollouts = collectRollouts(sessionsRoot)
rollouts.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
const traces = rollouts.slice(0, MAX_TRACES).map(convertFile).filter(t => t.events.length > 1)
mkdirSync(assetsDir, { recursive: true })
writeFileSync(join(assetsDir, 'traces.json'), JSON.stringify(traces))
console.log(`converted ${traces.length} traces (${traces.reduce((n, t) => n + t.events.length, 0)} events)`)

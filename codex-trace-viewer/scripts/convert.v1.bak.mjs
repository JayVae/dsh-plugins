#!/usr/bin/env node
// Convert Codex session rollouts (~/.codex/sessions/**/*.jsonl) into the
// trace JSON consumed by the Codex Trace Viewer plugin.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const sessionsRoot = join(homedir(), '.codex', 'sessions')
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'assets')
const LIMIT_EVENTS = 4000
const LIMIT_TEXT = 4000

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
    const o = JSON.parse(args)
    return clip(JSON.stringify(o, null, 2))
  } catch {
    return clip(args)
  }
}

function convertFile(path) {
  const meta = { id: basename(path, '.jsonl'), name: '', date: '', cwd: '', events: [] }
  const push = (kind, label, time, text) => {
    if (meta.events.length >= LIMIT_EVENTS) return
    meta.events.push({ kind, label, time, text })
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const t = o.timestamp ? o.timestamp.replace('T', ' ').slice(0, 19) : ''
    const p = o.payload || {}
    if (o.type === 'session_meta') {
      meta.id = p.id || meta.id
      meta.date = (p.timestamp || o.timestamp || '').slice(0, 10)
      meta.cwd = p.cwd || ''
      meta.name = meta.date + ' ' + (meta.cwd ? meta.cwd.split(/[\\/]/).pop() : meta.id.slice(0, 8))
      push('system', 'session', t, `cwd: ${p.cwd}\noriginator: ${p.originator}\ncli: ${p.cli_version}`)
    } else if (o.type === 'response_item') {
      if (p.type === 'message') {
        const role = p.role || 'assistant'
        const kind = role === 'user' ? 'user' : role === 'developer' || role === 'system' ? 'system' : 'assistant'
        const label = kind === 'system' ? role : kind
        const text = (p.content || []).map(c => c.text || '').join('\n')
        push(kind, label, t, clip(text))
      } else if (p.type === 'reasoning') {
        const text = (p.summary || []).map(s => s.text || '').join('\n')
        if (text) push('reasoning', 'reasoning', t, clip(text))
      } else if (p.type === 'function_call') {
        push('tool', `tool: ${p.name}`, t, truncateArgs(p.arguments))
      } else if (p.type === 'function_call_output') {
        const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output)
        push('tool_output', 'tool output', t, clip(out))
      } else if (p.type === 'tool_search_call') {
        push('tool', 'tool_search', t, truncateArgs(JSON.stringify(p.arguments || p)))
      } else if (p.type === 'tool_search_output') {
        push('tool_output', 'tool output', t, clip(JSON.stringify(p)))
      }
    }
    // event_msg/token_count, task_started/complete etc. intentionally skipped
    // to keep the view focused on the conversation trajectory.
  }
  return meta
}

const rollouts = collectRollouts(sessionsRoot)
rollouts.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
const traces = rollouts.slice(0, 50).map(convertFile).filter(t => t.events.length > 1)
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'traces.json')
writeFileSync(outPath, JSON.stringify(traces))
console.log(`wrote ${traces.length} traces (${traces.reduce((n, t) => n + t.events.length, 0)} events) to ${outPath}`)

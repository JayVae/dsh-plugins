window.__ModuleLoader__.load({ id: 'dsh-client-codex-trace-viewer', factory: (require) => {
  const React = require('react')
  const ReactDOM = require('react-dom/client')

  function h(tag, props, ...children) {
    return React.createElement(tag, props, ...children.flat(Infinity).filter(c => c !== undefined && c !== null && c !== false))
  }

  const KIND_COLOR = {
    tokens: '#e16f24',
    user: '#1a7f37', assistant: '#1f2328', reasoning: '#8250df',
    tool: '#0969da', tool_output: '#1a7f37', system: '#9a6700',
  }

  function shortTime(t) { return t ? t.slice(11) : '' }

  function fmtDur(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
  }

  function durBadge(ms) {
    return h('span', {
      title: 'duration',
      style: { fontSize: '10px', opacity: 0.8, background: 'rgba(9,105,218,0.14)', borderRadius: '8px', padding: '1px 6px', whiteSpace: 'nowrap' },
    }, fmtDur(ms))
  }

  function TimelineBar({ events, onJump, window: win, onWindowChange }) {
    const n = events.length
    const groups = React.useMemo(() => groupTurns(events).map(g => {
      const idxs = g.items.map(it => it.i)
      return { g, startI: Math.min(...idxs), endI: Math.max(...idxs) }
    }), [events])
    if (!n) return null
    const xPc = i => n > 1 ? (i / (n - 1)) * 100 : 0
    const lo = win ? win.lo : 0
    const hi = win ? win.hi : 100
    const inView = pc => pc >= lo && pc <= hi
    const leftPc = pc => ((pc - lo) / (hi - lo)) * 100
    const jumpTarget = g => {
      // Jump to the user message that opens the turn; fall back to anything visible.
      const it = g.items.find(({ ev }) => ev.kind === 'user')
        || g.items.find(({ ev }) => ev.kind !== 'turn')
        || g.items[0]
      return it.i
    }
    const turnLabel = g => {
      const u = g.userEv || g.items.map(x => x.ev).find(e => e.kind === 'user')
      const s = u ? (u.text || '').split('\n').map(x => x.trim()).find(Boolean) : null
      return (s || 'turn').slice(0, 42)
    }
    const turnTitle = g => {
      const first = g.items[0].ev, last = g.items[g.items.length - 1].ev
      const tk = g.items.map(x => x.ev).find(e => e.kind === 'tokens')
      const total = tk ? (tk.text.match(/total: (\d+)/) || [])[1] : null
      return '👤 ' + turnLabel(g)
        + ' · ' + shortTime(first.time) + (first.time !== last.time ? ' – ' + shortTime(last.time) : '')
        + (total ? ' · ' + total + ' tok' : '') + ' — click to jump'
    }
    // Lanes are always rendered (fixed heights) so panning never resizes the timeline.
    const lanes = [
      { key: 'reply', label: 'reply', kinds: ['assistant'] },
      { key: 'tool', label: 'tool', kinds: ['tool', 'tool_output', 'patch'] },
      { key: 'think', label: 'think', kinds: ['reasoning', 'subtask'] },
      { key: 'other', label: 'other', kinds: ['system'] },
    ]

    return h('div', {
      className: 'ctv-tl',
      onDoubleClick: () => onWindowChange && onWindowChange({ lo: 0, hi: 100 }),
      onWheel: e => {
        if (!onWindowChange || !e.shiftKey) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const trackLeft = rect.left + 48, trackRight = rect.right - 4
        const at = lo + Math.min(Math.max((e.clientX - trackLeft) / (trackRight - trackLeft), 0), 1) * (hi - lo)
        const factor = e.deltaY < 0 ? 0.8 : 1.25
        let w = (hi - lo) * factor
        w = Math.min(Math.max(w, 0.5), 100)
        let nlo = at - (at - lo) * (w / (hi - lo))
        nlo = Math.min(Math.max(nlo, 0), 100 - w)
        onWindowChange({ lo: nlo, hi: nlo + w })
      },
    },
      h('div', { className: 'ctv-tl-lane', style: { height: '24px' } },
        h('span', { className: 'ctv-tl-lane-label' }, 'turns'),
        h('div', { className: 'ctv-tl-track' },
          groups.map(({ g, startI, endI }) => {
            const a = xPc(startI), b = xPc(endI)
            if (b < lo || a > hi) return null
            const l = Math.max(leftPc(a), 0)
            const r = Math.min(leftPc(b), 100)
            const w = Math.max(r - l - 0.3, 1.4)
            return h('div', {
              key: g.key, className: 'ctv-tl-turnbar', title: turnTitle(g),
              style: { left: l + '%', width: w + '%' },
              onClick: () => onJump && onJump(jumpTarget(g)),
            }, '👤 ' + turnLabel(g))
          })),
      ),
      lanes.map(lane => {
        const items = []
        events.forEach((e, i) => {
          if (!lane.kinds.includes(e.kind)) return
          const pc = xPc(i)
          if (inView(pc)) items.push({ e, i, pc })
        })
        return h('div', { key: lane.key, className: 'ctv-tl-lane' },
          h('span', { className: 'ctv-tl-lane-label' }, lane.label),
          h('div', { className: 'ctv-tl-track' + (items.length ? '' : ' ctv-tl-track-empty') },
            items.map(({ e, i, pc }) => h('div', {
              key: i, className: 'ctv-tl-tick',
              title: (e.durMs != null ? fmtDur(e.durMs) + ' · ' : '') + e.label + ' ' + shortTime(e.time) + ' — click to jump',
              style: { left: `calc(${leftPc(pc)}% - 4px)`, background: KIND_COLOR[e.kind] || '#777' },
              onClick: () => onJump && onJump(i),
            }))))
      }),
      h(MiniMap, { events, lo, hi, onWindowChange }),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', opacity: 0.5, padding: '2px 4px 0 48px' } },
        h('span', null, (win && lo > 0 ? '⋯ ' : '') + shortTime(events[0].time)),
        h('span', null, win && (hi - lo) < 100 ? 'zoom ' + (hi - lo).toFixed(0) + '% · shift+wheel zoom · double-click reset' : 'shift+wheel zoom · double-click reset'),
        h('span', null, shortTime(events[events.length - 1].time) + (win && hi < 100 ? ' ⋯' : '')),
      ),
    )
  }

  function MiniMap({ events, lo, hi, onWindowChange }) {
    const canvasRef = React.useRef(null)
    const bins = React.useMemo(() => {
      const n = events.length
      const cols = Math.min(300, Math.max(n, 1))
      const out = new Array(cols).fill(null)
      events.forEach((e, i) => {
        const c = Math.min(cols - 1, Math.round((n > 1 ? i / (n - 1) : 0) * (cols - 1)))
        const kinds = out[c] || (out[c] = {})
        kinds[e.kind] = true
      })
      return out
    }, [events])
    React.useEffect(() => {
      const cv = canvasRef.current
      if (!cv) return
      const w = cv.clientWidth, ht = cv.clientHeight
      if (!w) return
      cv.width = w; cv.height = ht
      const ctx = cv.getContext('2d')
      ctx.clearRect(0, 0, w, ht)
      const cols = bins.length
      const step = cols > 1 ? (w - 2) / (cols - 1) : 0
      bins.forEach((kinds, c) => {
        if (!kinds) return
        const x = Math.round(c * step) + 1
        Object.keys(kinds).forEach((kind, k) => {
          ctx.fillStyle = KIND_COLOR[kind] || '#777'
          ctx.fillRect(Math.min(x + k, w - 1), 3, 1, ht - 6)
        })
      })
    }, [bins])
    const startDrag = e => {
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget
      const track = el.parentElement
      const w = hi - lo
      const startX = e.clientX, startLo = lo
      const move = ev => {
        const r = track.getBoundingClientRect()
        const d = ((ev.clientX - startX) / r.width) * 100
        let nlo = startLo + d
        nlo = Math.min(Math.max(nlo, 0), 100 - w)
        onWindowChange({ lo: nlo, hi: nlo + w })
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('lostpointercapture', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('lostpointercapture', up)
      try { el.setPointerCapture(e.pointerId) } catch (err) { /* older browsers */ }
    }
    const centerOn = e => {
      const r = e.currentTarget.getBoundingClientRect()
      const w = hi - lo
      let nlo = ((e.clientX - r.left) / r.width) * 100 - w / 2
      nlo = Math.min(Math.max(nlo, 0), 100 - w)
      onWindowChange({ lo: nlo, hi: nlo + w })
    }
    return h('div', { className: 'ctv-tl-mini', onPointerDown: centerOn, title: 'drag window to pan · click to center · shift+wheel to zoom' },
      h('canvas', { ref: canvasRef, className: 'ctv-tl-mini-canvas' }),
      h('div', { className: 'ctv-tl-mini-win', style: { left: lo + '%', width: (hi - lo) + '%' }, onPointerDown: startDrag }),
    )
  }

  function EventCard({ ev, highlight, refFn }) {
    const color = KIND_COLOR[ev.kind] || '#777'
    return h('div', {
      ref: refFn,
      className: 'ctv-ev' + (highlight ? ' ctv-ev-highlight' : ''),
    },
      h('div', { className: 'ctv-ev-head', style: { borderLeft: `3px solid ${color}` } },
        h('span', { className: 'ctv-ev-kind', style: { color } }, ev.label),
        h('span', { className: 'ctv-ev-time', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } },
          ev.durMs != null && durBadge(ev.durMs),
          ev.time),
      ),
      h('pre', { className: 'ctv-ev-text' }, ev.text),
    )
  }

  // Group a filtered event list into turns. A turn opens at the first
  // user message (opencode: kind 'user'; codex: 'turn' marker precedes user).
  function groupTurns(events) {
    const groups = []
    let cur = null
    events.forEach((ev, i) => {
      if (ev.kind === 'turn' || (ev.kind === 'user' && (!cur || cur.closed))) {
        cur = { key: 'turn-' + i, label: ev.kind === 'turn' ? ev.label : 'turn', open: ev.kind === 'user', userEv: ev.kind === 'user' ? ev : null, items: [], startIdx: i }
        cur.items.push({ ev, i })
        groups.push(cur)
      } else if (!cur) {
        // leading system/context events before any turn
        cur = { key: 'pre', label: 'context', open: true, userEv: null, items: [], startIdx: i }
        groups.push(cur)
        cur.items.push({ ev, i })
      } else {
        if (ev.kind === 'user' && cur && cur.userEv) {
          // consecutive user message with an open turn: start new group
          cur = { key: 'turn-' + i, label: 'turn', open: true, userEv: ev, items: [], startIdx: i }
          groups.push(cur)
        }
        cur.items.push({ ev, i })
      }
    })
    return groups
  }

  // One slim, collapsed-by-default row in a turn's call chain. Tool outputs
  // and token events are attached to their owning tool row and only become
  // visible when the row is expanded.
  function ChainRow({ row, highlightIdx, cardRefs, toolsFolded }) {
    const [open, setOpen] = React.useState(false)
    const meHi = highlightIdx === row.i || row.outs.some(o => o.i === highlightIdx)
    React.useEffect(() => { if (meHi) setOpen(true) }, [meHi])
    if (toolsFolded && row.tool) return null
    const icon = row.tool ? '🔧' : row.type === 'reasoning' ? '🤔' : row.type === 'assistant' ? '💬' : '⚙️'
    const name = row.tool
      ? (row.ev.label.replace(/^tool: /, '').replace(/^patch.*/, 'patch') || 'tool')
      : row.type === 'assistant' ? 'output' : row.ev.label
    const refFn = node => {
      cardRefs.current[row.i] = node
      row.outs.forEach(o => { cardRefs.current[o.i] = node })
    }
    return h('div', {
      ref: refFn,
      className: 'ctv-chain-row' + (meHi ? ' ctv-ev-highlight' : ''),
    },
      h('div', { className: 'ctv-chain-head', onClick: () => setOpen(o => !o) },
        h('span', { className: 'ctv-chain-icon' }, icon),
        h('span', { className: 'ctv-chain-name' }, name),
        row.ev.durMs != null && durBadge(row.ev.durMs),
        row.outs.length > 0 && h('span', { className: 'ctv-chain-outs' }, '+' + row.outs.length + ' out'),
        h('span', { className: 'ctv-chain-time' }, shortTime(row.ev.time)),
        h('span', { className: 'ctv-folder-arrow' }, open ? '▾' : '▸'),
      ),
      open && h('pre', { className: 'ctv-ev-text' },
        row.ev.text + (row.outs.length ? '\n\n' + row.outs.map(o => '--- output ---\n' + o.ev.text).join('\n\n') : '')),
    )
  }

  // Collapsible middle-process area between the user input and the result.
  function ProcessGroup({ rows, highlightIdx, cardRefs, toolsFolded }) {
    const [open, setOpen] = React.useState(false)
    const hiCount = rows.filter(r => highlightIdx === r.i || r.outs.some(o => o.i === highlightIdx)).length
    React.useEffect(() => { if (hiCount) setOpen(true) }, [hiCount])
    const visible = toolsFolded ? rows.filter(r => !r.tool) : rows
    if (!visible.length) return null
    const counts = { tool: 0, reasoning: 0, output: 0, other: 0 }
    visible.forEach(r => {
      if (r.tool) counts.tool++
      else if (r.type === 'reasoning') counts.reasoning++
      else if (r.type === 'assistant') counts.output++
      else counts.other++
    })
    const meta = [
      counts.tool > 0 && `🔧 工具 ${counts.tool}`,
      counts.reasoning > 0 && `🤔 思考 ${counts.reasoning}`,
      counts.output > 0 && `💬 输出 ${counts.output}`,
      counts.other > 0 && `⚙️ 其他 ${counts.other}`,
    ].filter(Boolean).join(' · ')
    return h('div', { className: 'ctv-process' + (hiCount ? ' ctv-process-hi' : '') },
      h('div', { className: 'ctv-process-head', onClick: () => setOpen(o => !o) },
        h('span', { className: 'ctv-folder-arrow' }, open ? '▾' : '▸'),
        h('span', { className: 'ctv-process-label' }, '中间过程'),
        h('span', { className: 'ctv-process-meta' }, meta),
        hiCount > 0 && h('span', { className: 'ctv-process-hint' }, '含跳转目标'),
        h('span', { className: 'ctv-process-toggle' }, open ? '点击折叠' : '点击展开'),
      ),
      open && visible.map(row => h(ChainRow, {
        key: row.i, row, highlightIdx, cardRefs, toolsFolded,
      })),
    )
  }

  function TurnGroup({ group, highlightIdx, cardRefs, openTurns, toggleTurn, toolsFolded }) {
    const [open, setOpen] = React.useState(group.open)
    const userEv = group.userEv || group.items.map(x => x.ev).find(e => e.kind === 'user')
    const isOpen = openTurns ? !!openTurns[group.key] : open
    const setOpenSafe = v => openTurns && toggleTurn ? toggleTurn(group.key, v) : setOpen(v)
    React.useEffect(() => {
      if (openTurns && toggleTurn) setOpen(false)
    }, [])
    const evs = group.items.map(x => x.ev)
    const kinds = {}
    for (const ev of evs) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1
    const summary = Object.entries(kinds).filter(([k]) => k !== 'user' && k !== 'tokens' && k !== 'turn').map(([k, n]) => n + ' ' + k).join(', ')
    const span = group.items.length > 1
      ? (group.items[group.items.length - 1].ev.time || '').slice(11) + ' – ' + (group.items[0].ev.time || '').slice(11)
      : ''
    const tokensEv = evs.find(e => e.kind === 'tokens')
    const totalTok = tokensEv ? (tokensEv.text.match(/total: (\d+)/) || [])[1] : null
    const userExcerpt = userEv ? (userEv.text || '').split('\n').map(s => s.trim()).find(Boolean) : null
    const hasHighlight = group.items.some(({ i }) => highlightIdx === i)
    // Build the readable story of a turn: user input, tool/reasoning/output
    // chain rows, with the last assistant message promoted to the result.
    const chain = []
    for (const { ev, i } of group.items) {
      if (ev.kind === 'turn') continue
      if (ev.kind === 'tool_output' || ev.kind === 'tokens') {
        for (let k = chain.length - 1; k >= 0; k--) {
          if (chain[k].tool) { chain[k].outs.push({ ev, i }); break }
        }
        continue
      }
      const type = ev.kind === 'tool' || ev.kind === 'patch' || ev.kind === 'subtask' ? 'tool' : ev.kind
      chain.push({ type, ev, i, outs: [], tool: type === 'tool' })
    }
    for (let k = chain.length - 1; k >= 0; k--) {
      if (chain[k].type === 'assistant') { chain[k].result = true; break }
    }
    return h('div', { className: 'ctv-turn' + (hasHighlight ? ' ctv-turn-highlight' : '') },
      h('div', { className: 'ctv-turn-head', onClick: () => setOpenSafe(!isOpen) },
        h('span', { className: 'ctv-folder-arrow' }, isOpen ? '▾' : '▸'),
        userEv && h('span', null, '👤'),
        h('span', { className: 'ctv-turn-label', title: userExcerpt || group.label },
          userExcerpt ? userExcerpt.slice(0, 80) : group.label),
        h('span', { className: 'ctv-turn-meta' }, summary),
        totalTok && h('span', { className: 'ctv-chip' }, totalTok + ' tok'),
        h('span', { className: 'ctv-turn-time' }, span),
      ),
      isOpen && (() => {
        const rows = chain.filter(r => r.type !== 'user' && !r.result)
        const userRow = chain.find(r => r.type === 'user')
        const resultRow = chain.find(r => r.result)
        return [
          userRow && h(EventCard, {
            key: 'u', ev: userRow.ev,
            highlight: highlightIdx === userRow.i,
            refFn: node => {
              cardRefs.current[userRow.i] = node
              userRow.outs.forEach(o => { cardRefs.current[o.i] = node })
            },
          }),
          h(ProcessGroup, { key: 'proc', rows, highlightIdx, cardRefs, toolsFolded }),
          resultRow && h(EventCard, {
            key: 'r', ev: resultRow.ev,
            highlight: highlightIdx === resultRow.i,
            refFn: node => {
              cardRefs.current[resultRow.i] = node
              resultRow.outs.forEach(o => { cardRefs.current[o.i] = node })
            },
          }),
        ]
      })(),
    )
  }

  function TraceView({ trace, onBack }) {
    const [filter, setFilter] = React.useState('all')
    const [query, setQuery] = React.useState('')
    const [highlightIdx, setHighlightIdx] = React.useState(null)
    const [win, setWin] = React.useState({ lo: 0, hi: 100 })
    const [toolsFolded, setToolsFolded] = React.useState(false)
    const [openTurns, setOpenTurns] = React.useState(() => {
      const m = {}
      groupTurns(trace.events).forEach(g => { if (g.open) m[g.key] = true })
      return m
    })
    const [pendingJump, setPendingJump] = React.useState(null)
    const cardRefs = React.useRef({})
    const eventsRef = React.useRef(null)
    const kinds = ['all', 'user', 'assistant', 'reasoning', 'tool', 'tool_output', 'tokens']
    const q = query.trim().toLowerCase()
    const shown = trace.events
      .filter(e => filter === 'all' || e.kind === filter)
      .filter(e => !q || (e.text || '').toLowerCase().includes(q) || (e.label || '').toLowerCase().includes(q))
    const groups = groupTurns(shown)
    const groupOfIdx = new Map()
    groups.forEach(g => g.items.forEach(({ i }) => groupOfIdx.set(i, g)))

    const toggleTurn = (key, v) => setOpenTurns(prev => {
      const next = Object.assign({}, prev)
      if (v) next[key] = true; else delete next[key]
      return next
    })

    const jumpTo = idx => {
      const ev = shown[idx]
      let target = ev
      if (toolsFolded && (ev.kind === 'tool_output' || ev.kind === 'patch' || ev.kind === 'tokens')) {
        for (let j = idx - 1; j >= 0; j--) {
          if (shown[j].kind === 'tool') { target = shown[j]; break }
          if (['user', 'assistant', 'reasoning', 'tool', 'system'].includes(shown[j].kind)) { target = shown[j]; break }
        }
      }
      const ti = shown.indexOf(target)
      const g = groupOfIdx.get(ti)
      if (g) {
        const next = {}
        for (const gr of groups) if (gr.key === g.key) next[gr.key] = true
        setOpenTurns(next)
      }
      setHighlightIdx(trace.events.indexOf(target))
      setPendingJump({ idx: trace.events.indexOf(target), tries: 0 })
    }

    React.useEffect(() => {
      if (!pendingJump) return
      // After expanding a turn, row mounts take a few frames; retry until the
      // target card is mounted and has a real height, then scroll it to center.
      let raf = 0, timer = 0, tries = 0
      const attempt = () => {
        const node = cardRefs.current[pendingJump.idx]
        if (node && node.getBoundingClientRect().height > 0) {
          const container = eventsRef.current
          if (container) {
            const r = node.getBoundingClientRect()
            const c = container.getBoundingClientRect()
            const STICKY = 190
            const to = container.scrollTop + (r.top - c.top) - c.height / 2 + r.height / 2
            container.scrollTo({ top: Math.max(to, 0), behavior: 'smooth' })
            node.style.boxShadow = '0 0 0 2px #0969da'
            setTimeout(() => { node.style.boxShadow = '' }, 1600)
          }
          setPendingJump(null)
          return
        }
        tries++
        if (tries > 30) { setPendingJump(null); return }
        raf = requestAnimationFrame(attempt)
      }
      timer = setTimeout(attempt, 50)
      return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
    }, [pendingJump, openTurns, toolsFolded])

    return h('div', { className: 'ctv-main', ref: eventsRef },
      h('div', { className: 'ctv-toolbar' },
        h('button', { className: 'ctv-back', onClick: onBack }, '← Back'),
        h('div', { className: 'ctv-title' },
          h('div', { className: 'ctv-title-name' }, trace.name),
          h('div', { className: 'ctv-title-meta' },
            h('span', { title: trace.cwd }, trace.cwd || ''),
            trace.model && h('span', { className: 'ctv-chip' }, trace.model),
            h('span', null, `${trace.date} · ${trace.events.length} events`))),
        h('input', {
          className: 'ctv-search',
          placeholder: 'Search in session…',
          value: query,
          onChange: e => setQuery(e.target.value),
        }),
        h('button', {
          className: 'ctv-filter' + (toolsFolded ? ' ctv-filter-on' : ''),
          title: 'Tool chain rows collapsed by default; toggle to hide tool rows entirely',
          onClick: () => setToolsFolded(v => !v),
        }, toolsFolded ? '🔧 folded' : '🔧 chain'),
      ),
      h('div', { className: 'ctv-timeline-wrap' },
        h(TimelineBar, { events: shown, window: win, onWindowChange: setWin, onJump: jumpTo })),
      h('div', { className: 'ctv-events' },
        q && h('div', { className: 'ctv-search-info' }, `${shown.length} matches for "${query}"`),
        groups.map(group => h(TurnGroup, {
          key: group.key,
          group,
          highlightIdx,
          cardRefs,
          openTurns,
          toggleTurn,
          toolsFolded,
        }))),
    )
  }

  function Resizer({ onResize }) {
    const startDrag = e => {
      e.preventDefault()
      const el = e.currentTarget
      const move = ev => onResize(Math.min(Math.max(220, ev.clientX), window.innerWidth - 320))
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('lostpointercapture', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('lostpointercapture', up)
      try { el.setPointerCapture(e.pointerId) } catch (err) { /* older browsers */ }
    }
    return h('div', { className: 'ctv-resizer', onPointerDown: startDrag })
  }

  function TraceList({ traces, onOpen, width }) {
    const folders = new Map()
    for (const t of traces) {
      const f = t.folder || '(no cwd)'
      if (!folders.has(f)) folders.set(f, [])
      folders.get(f).push(t)
    }
    const [collapsed, setCollapsed] = React.useState(() => new Set())
    const toggleFolder = f => setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f); else next.add(f)
      return next
    })
    return h('div', { className: 'ctv-sidebar', style: { width } },
      [...folders.entries()].map(([folder, items]) => h('div', { key: folder, className: 'ctv-folder' },
        h('div', { className: 'ctv-folder-head', onClick: () => toggleFolder(folder) },
          h('span', { className: 'ctv-folder-arrow' }, collapsed.has(folder) ? '▸' : '▾'),
          h('span', { className: 'ctv-folder-name', title: folder }, folder),
          h('span', { className: 'ctv-folder-count' }, items.length)),
        !collapsed.has(folder) && items.map(t => h('div', {
          key: t.id, className: 'ctv-item', onClick: () => onOpen(t),
          title: `${t.cwd}\n${t.name}`,
        },
          h('div', { className: 'ctv-item-name' }, t.name),
          h('div', { className: 'ctv-item-meta' }, `${t.date} · ${t.events.length} events`),
        )))))
  }

  function CodexTraceApp() {
    const [traces, setTraces] = React.useState(null)
    const [selected, setSelected] = React.useState(null)
    const [error, setError] = React.useState(null)
    const [sidebarWidth, setSidebarWidth] = React.useState(300)

    React.useEffect(() => {
      // Traces JSON is served by the host companion (lib/index.js) at a fixed
      // route and re-read from disk per request — new sessions appear on
      // refresh without a rebuild. The viewer may run in a popup written via
      // document.write (about:blank), so resolve the route against the opener.
      const base = (() => {
        try { if (window.opener) return new URL('/', window.opener.location.href).origin } catch { /* cross-origin or closed opener */ }
        return window.location.origin
      })()
      let cancelled = false
      fetch(base + '/.dsh-codex-trace-viewer/traces')
        .then(r => r.json().then(body => r.ok ? body : Promise.reject(new Error(body.error || `HTTP ${r.status}`))))
        .then(data => { if (!cancelled) setTraces(data) })
        .catch(e => { if (!cancelled) setError(String(e)) })
      return () => { cancelled = true }
    }, [])

    if (error) return h('div', { className: 'ctv-root' }, 'Failed to load traces: ' + error)
    if (!traces) return h('div', { className: 'ctv-root' }, 'Loading Codex traces…')
    if (traces.length === 0) return h('div', { className: 'ctv-root' }, 'No Codex traces found. Run scripts/convert.mjs first.')

    return selected === null
      ? h('div', { className: 'ctv-root' },
          h(TraceList, { traces, onOpen: t => setSelected(t), width: sidebarWidth }),
          h(Resizer, { onResize: setSidebarWidth }),
          h('div', { className: 'ctv-main ctv-empty' },
            h('div', null,
              h('div', { style: { fontSize: '40px' } }, '🧭'),
              h('div', { style: { fontSize: '16px', fontWeight: 600, marginTop: '8px' } }, 'Select a Codex session'),
              h('div', { style: { opacity: 0.6, marginTop: '4px' } }, `${traces.length} sessions grouped by project folder`))))
      : h('div', { className: 'ctv-root' },
          h(TraceList, { traces, onOpen: t => setSelected(t), width: sidebarWidth }),
          h(Resizer, { onResize: setSidebarWidth }),
          h(TraceView, { trace: selected, onBack: () => setSelected(null) }))
  }

  const style = typeof document !== 'undefined' ? document.createElement('style') : { textContent: '', remove() {} }
  if (style.dataset) style.dataset.plugin = 'dsh-client-codex-trace-viewer'
  style.textContent = `
    body { margin: 0; font-family: system-ui, sans-serif; background: #f6f8fa; color: #1f2328; }
    .ctv-root { display: flex; height: 100vh; font-size: 13px; }
    .ctv-resizer { width: 9px; margin: 0 -2px; cursor: col-resize; background: transparent; flex-shrink: 0; position: relative; z-index: 5; touch-action: none; }
    .ctv-resizer:hover, .ctv-resizer.ctv-resizing { background: rgba(9,105,218,0.35); }
    .ctv-sidebar { width: 300px; min-width: 220px; max-width: 60vw; overflow-y: auto; border-right: 1px solid #d0d7de; padding: 8px; flex: 0 0 auto; background: #fff; }
    .ctv-folder-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-weight: 700; cursor: pointer; border-radius: 6px; position: sticky; top: 0; background: #fff; z-index: 1; }
    .ctv-folder-head:hover { background: rgba(0,0,0,0.04); }
    .ctv-folder-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ctv-folder-count { font-size: 11px; font-weight: 400; opacity: 0.55; background: rgba(0,0,0,0.06); border-radius: 10px; padding: 1px 7px; }
    .ctv-folder-arrow { font-size: 10px; opacity: 0.6; width: 10px; }
    .ctv-item { padding: 7px 10px 7px 26px; border-radius: 6px; cursor: pointer; }
    .ctv-item:hover { background: rgba(9,105,218,0.08); }
    .ctv-item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ctv-item-meta { font-size: 11px; opacity: 0.55; margin-top: 2px; }
    .ctv-main { flex: 1; overflow-y: auto; min-width: 0; display: flex; flex-direction: column; }
    .ctv-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #d0d7de; background: #fff; z-index: 2; }
    .ctv-back { border: 1px solid #d0d7de; background: #fff; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
    .ctv-back:hover { background: #f3f4f6; }
    .ctv-title { flex: 1; min-width: 0; }
    .ctv-title-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .ctv-title-meta { font-size: 11px; opacity: 0.7; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ctv-title-meta > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .ctv-chip { font-size: 10px; opacity: 0.9; background: rgba(9,105,218,0.10); border: 1px solid rgba(9,105,218,0.25); color: #0969da; border-radius: 9px; padding: 1px 8px; white-space: nowrap; flex-shrink: 0; }
    .ctv-ev-kind.tokens, .ctv-filter-tokens { }
    .ctv-filters { display: flex; gap: 4px; }
    .ctv-filter { border: 1px solid #d0d7de; background: #fff; border-radius: 14px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
    .ctv-filter-on { background: #0969da; border-color: #0969da; color: #fff; }
    .ctv-timeline-wrap { background: #fff; border-bottom: 1px solid #d0d7de; position: sticky; top: 0; z-index: 6; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
    .ctv-tl { padding: 6px 10px 12px; user-select: none; }
    .ctv-tl-lane { display: flex; align-items: center; height: 26px; gap: 6px; }
    .ctv-tl-mini { position: relative; height: 22px; margin: 4px 4px 0 48px; background: rgba(127,127,127,0.08); border-radius: 5px; overflow: hidden; cursor: pointer; }
    .ctv-tl-mini-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
    .ctv-tl-mini-win { position: absolute; top: 0; height: 100%; background: rgba(9,105,218,0.18); border: 1px solid rgba(9,105,218,0.55); border-radius: 4px; cursor: grab; box-sizing: border-box; }
    .ctv-tl-mini-win:active { cursor: grabbing; background: rgba(9,105,218,0.28); }
    .ctv-tl-lane-label { width: 42px; flex-shrink: 0; font-size: 10px; opacity: 0.55; text-align: right; }
    .ctv-tl-track { position: relative; flex: 1; height: 100%; background: rgba(127,127,127,0.10); border-radius: 6px; overflow: hidden; }
    .ctv-tl-turnbar { position: absolute; top: 3px; height: 20px; min-width: 18px; background: rgba(26,127,55,0.18); border: 1px solid rgba(26,127,55,0.55); border-radius: 5px; color: #1a7f37; font-size: 10px; line-height: 18px; padding: 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; box-sizing: border-box; }
    .ctv-tl-turnbar:hover { background: rgba(26,127,55,0.32); }
    .ctv-tl-tick { position: absolute; top: 6px; width: 8px; height: 14px; border-radius: 2px; opacity: 0.85; cursor: pointer; }
    .ctv-tl-tick:hover { opacity: 1; box-shadow: 0 0 0 2px rgba(9,105,218,0.45); }
    .ctv-tl-track-empty { opacity: 0.35; }
    .ctv-search { border: 1px solid #d0d7de; border-radius: 14px; padding: 5px 12px; font-size: 12px; width: 180px; outline: none; background: #fff; color: inherit; }
    .ctv-search:focus { border-color: #0969da; width: 240px; }
    .ctv-search-info { padding: 6px 2px; font-size: 11px; opacity: 0.65; }
    .ctv-ev-highlight { border-color: #0969da !important; }
    .ctv-events { padding: 10px 14px; flex: 1; }
    .ctv-empty { align-items: center; justify-content: center; display: flex; text-align: center; }
    .ctv-turn { margin-bottom: 10px; }
    .ctv-turn-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: rgba(127,127,127,0.08); border: 1px solid rgba(127,127,127,0.25); border-radius: 8px 8px 0 0; cursor: pointer; }
    .ctv-turn-head:hover { background: rgba(127,127,127,0.14); }
    .ctv-turn-label { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ctv-turn-meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
    .ctv-turn-time { font-size: 11px; opacity: 0.5; white-space: nowrap; }
    .ctv-turn-highlight > .ctv-turn-head { border-color: #0969da; box-shadow: 0 0 0 1px #0969da; }
    .ctv-turn > .ctv-ev { border-radius: 0; margin-bottom: 0; border-top: none; }
    .ctv-turn > .ctv-ev:last-child { border-radius: 0 0 8px 8px; border-bottom: 1px solid #d0d7de; }
    .ctv-process { border: 1px dashed #d0d7de; border-radius: 8px; margin: 6px 0; overflow: hidden; background: rgba(127,127,127,0.04); }
    .ctv-process-head { display: flex; align-items: center; gap: 8px; padding: 5px 12px; cursor: pointer; font-size: 12px; color: #57606a; }
    .ctv-process-head:hover { background: rgba(9,105,218,0.05); }
    .ctv-process-label { font-weight: 600; }
    .ctv-process-meta { font-size: 11px; opacity: 0.75; }
    .ctv-process-hint { margin-left: auto; font-size: 10px; color: #0969da; background: rgba(9,105,218,0.1); border-radius: 8px; padding: 1px 8px; }
    .ctv-process-toggle { margin-left: auto; font-size: 10px; opacity: 0.55; }
    .ctv-process-head .ctv-process-hint + .ctv-process-toggle { margin-left: 8px; }
    .ctv-process-hi { border-color: rgba(9,105,218,0.5); }
    .ctv-process .ctv-chain-row { margin-left: 12px; margin-right: 12px; }
    .ctv-chain { display: flex; flex-direction: column; }
    .ctv-chain-row { background: #fff; border: 1px solid #e4e8ec; border-left: 2px solid #d0d7de; border-radius: 6px; margin: 0 0 4px 26px; overflow: hidden; }
    .ctv-chain-row:hover { border-left-color: #0969da; }
    .ctv-chain-head { display: flex; align-items: center; gap: 7px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
    .ctv-chain-head:hover { background: rgba(9,105,218,0.05); }
    .ctv-chain-icon { font-size: 11px; }
    .ctv-chain-name { font-weight: 600; color: #0969da; }
    .ctv-chain-outs { font-size: 10px; opacity: 0.55; background: rgba(0,0,0,0.05); border-radius: 8px; padding: 0 6px; }
    .ctv-chain-time { margin-left: auto; opacity: 0.5; font-size: 10px; }
    .ctv-chain-row .ctv-ev-text { max-height: 280px; }
    .ctv-chain-row.ctv-ev-highlight { border-color: #0969da; box-shadow: 0 0 0 1px #0969da; }
    .ctv-ev { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
    .ctv-ev-head { display: flex; justify-content: space-between; padding: 5px 10px; background: rgba(0,0,0,0.03); }
    .ctv-ev-kind { font-weight: 600; font-size: 12px; }
    .ctv-ev-time { opacity: 0.55; font-size: 11px; }
    .ctv-ev-text { margin: 0; padding: 8px 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow-y: auto; border-top: 1px solid rgba(0,0,0,0.05); }
  `
  if (typeof document !== 'undefined' && document.head) document.head.appendChild(style)

  function openViewer() {
    const win = window.open('', '_blank', 'width=1360,height=900')
    if (!win) return
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Codex Trace Viewer</title><style>${style.textContent}</style></head><body><div id="ctv-root"></div></body></html>`)
    win.document.close()
    const root = ReactDOM.createRoot(win.document.getElementById('ctv-root'))
    root.render(React.createElement(CodexTraceApp))
  }

  function viewerButton({ compact } = {}) {
    return h('button', {
      onClick: openViewer,
      type: 'button',
      'aria-label': 'Codex Traces',
      title: 'Codex Traces',
      style: {
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: compact ? '6px' : '6px 10px', border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: '8px', background: 'transparent', color: 'inherit', fontSize: '12px',
      },
    }, '🧭', !compact && h('span', null, 'Codex Traces'))
  }

  function apply(ctx) {
    ctx.effect(() => () => style.remove(), 'codex-trace-viewer: style lifetime')
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register({ name: 'sidebar.footer.action', id: 'codex-trace-viewer', order: 150 }, ({ wide }) => viewerButton({ compact: !wide })))
  }

  return { name: 'codex-trace-viewer', inject: ['slots'], apply }
} });

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row } from '../types'

const PANE = 'omok-explorer'
const HIDDEN = new Set(['.git', '__pycache__', 'node_modules', '.omc'])
const open = atom({ plugin: 'omok-explorer', key: 'open' } as const, [] as string[])
const width = atom({ plugin: 'omok-explorer', key: 'width' } as const, 36)
const busy = atom({ plugin: 'omok-explorer', key: 'busy' } as const, false)
const tick = atom({ plugin: 'omok-explorer', key: 'tick' } as const, 0)
const top = atom({ plugin: 'omok-explorer', key: 'top' } as const, 0)
const rows = atom({ plugin: 'omok-explorer', key: 'rows' } as const, [] as Row[])

const build = async ($: any, expanded: string[]): Promise<Row[]> => {
  const out: Row[] = []
  const walk = async (dir: string, depth: number) => {
    const entries = (await $.fs.list(dir || undefined)) as { name: string; kind: string }[]
    const sorted = entries
      .filter(x => !HIDDEN.has(x.name))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    for (const x of sorted) {
      const path = dir ? `${dir}/${x.name}` : x.name
      const isDir = x.kind === 'dir'
      const isOpen = isDir && expanded.includes(path)
      out.push({ path, name: x.name, depth, isDir, isOpen })
      if (isOpen) await walk(path, depth + 1)
    }
  }
  await walk('', 0)
  return out
}

const refresh = async ($: any) => {
  const expanded = await read($, open)
  await update($, rows, () => [] as Row[])
  const next = await build($, expanded)
  await update($, rows, () => next)
}

const SP = '\u00A0'
const ORANGE = '#DA7756'
const DARK = '#141413'
const CHAR_ROWS = 9
const MIN_WIDTH = 28

// Clawd as pixel art, 12 columns, each cell two terminal columns wide:
// # body, E eye, e shut eye, . empty. Taken from claude.dev/shared/img/clawd-mark.png.
const BODY = [
  '..########..',
  '..#E####E#..',
  '############',
  '############',
  '..########..',
  '..########..',
]
const SHUT = [BODY[0], '..#e####e#..', ...BODY.slice(2)]
const LEGS = '..#.#..#.#..'
const LEFT_UP = ['..#.#..#.#..', '.......#.#..']
const RIGHT_UP = ['..#.#..#.#..', '..#.#.......']
const BOTH = [LEGS, LEGS]
const GAP = '............'

const STOMP: string[][] = [
  [GAP, ...BODY, ...LEFT_UP],
  [...BODY, GAP, ...BOTH],
  [GAP, ...BODY, ...RIGHT_UP],
  [...BODY, GAP, ...BOTH],
]
// Resting: the same body and four legs as the mark, squatting one row lower, legs a row short.
const REST: string[][] = [
  [GAP, GAP, ...BODY, LEGS],
  [GAP, GAP, ...SHUT, LEGS],
]

const runs = (row: string) => {
  const out: { c: string; n: number }[] = []
  for (const c of row) {
    const last = out[out.length - 1]
    if (last && last.c === c) last.n += 1
    else out.push({ c, n: 1 })
  }
  return out
}

const show = async ($: any) => {
  const columns = await read($, width)
  return $.ui.open({ id: PANE, title: 'Explorer', columns })
}

let timer: { cancel: () => void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'explorer', description: 'Open the /omok file explorer pane' })
    await refresh($)
    void show($)
    timer?.cancel()
    let n = 0
    timer = $.clock.every(300, () => {
      n += 1
      void read($, busy).then(isBusy => {
        if (isBusy || n % 3 === 0) void update($, tick, t => t + 1)
      })
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, busy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await update($, busy, () => false)
    return done
  })

  on('command.run', { command: 'explorer' }, async $ => {
    await refresh($)
    await show($)
    return { text: 'Explorer pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)

    const toggle = async (path: string) => {
      await update($, open, cur => (cur.includes(path) ? cur.filter(p => p !== path) : [...cur, path]))
      await refresh($)
    }

    const cols = await read($, width)
    const resize = async (delta: number) => {
      await update($, width, w => Math.min(80, Math.max(MIN_WIDTH, w + delta)))
      await show($)
    }

    const isBusy = await read($, busy)
    const t = await read($, tick)
    const art = isBusy ? STOMP[t % STOMP.length] : REST[t % REST.length]
    const bodyRows = (e.props as { scroll?: { bodyRows?: number } } | undefined)?.scroll?.bodyRows
    const room = Math.max(8, bodyRows ?? (e.viewport?.rows ?? 24) - 4)
    const visible = Math.max(3, room - 1 - CHAR_ROWS - 3)
    const start = Math.min(await read($, top), Math.max(0, list.length - visible))
    const bodyCols = (e.props as { bodyColumns?: number } | undefined)?.bodyColumns ?? cols
    const clip = (t: string) => (t.length > bodyCols - 1 ? `${t.slice(0, Math.max(1, bodyCols - 2))}…` : t)
    const shown = list.slice(start, start + visible)
    const hidden = list.length - shown.length
    const scrollBy = (d: number) => update($, top, v => Math.max(0, v + d))
    const pad = Math.max(0, visible - shown.length)

    return (
      <Box flexDirection="column">
        <Box flexWrap="nowrap" gap={1}>
          <Button plain key="refresh" label="↻" onPress={() => refresh($)} />
          <Button plain key="narrower" label="−" onPress={() => resize(-6)} />
          <Text dimColor>{String(cols)}</Text>
          <Button plain key="wider" label="+" onPress={() => resize(6)} />
          <Button plain key="up" label="▲" onPress={() => scrollBy(-5)} />
          <Button plain key="down" label="▼" onPress={() => scrollBy(5)} />
        </Box>
        {list.length === 0 && <Text dimColor>Empty.</Text>}
        {shown.map(r => (
          <Button
            plain
            key={r.path}
            label={clip(`${'  '.repeat(r.depth)}${r.isDir ? (r.isOpen ? '▾ ' : '▸ ') : '  '}${r.name}${r.isDir ? '/' : ''}`)}
            onPress={() => (r.isDir ? toggle(r.path) : void $.prompt.fill({ text: `@${r.path} `, mode: 'insert' }))}
          />
        ))}
        <Text dimColor>{clip(hidden > 0 ? `… ${hidden} more (▲▼)` : ' ')}</Text>
        <Box flexDirection="column">
          {Array.from({ length: pad }).map(() => (
            <Text> </Text>
          ))}
          {art.map(row => (
            <Box flexWrap="nowrap" flexShrink={0}>
              <Text>{SP}</Text>
              {runs(row).map(r => (
                <Box flexShrink={0}>
                  <Text
                    color={r.c === 'e' ? DARK : undefined}
                    backgroundColor={r.c === '.' ? undefined : r.c === 'E' ? DARK : ORANGE}
                  >
                    {r.c === 'e' ? '▁▁'.repeat(r.n) : SP.repeat(r.n * 2)}
                  </Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

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
const pos = atom({ plugin: 'omok-explorer', key: 'pos' } as const, { x: 0, dir: 0, hold: 0 })
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
const BODY_COLOR = '#FF3B1D'
const DARK = '#141413'
const CHAR_ROWS = 5
const MIN_WIDTH = 28

// Clawd as pixel art, 12 columns by 9 rows, drawn at half size: one terminal column per pixel,
// two pixel rows per terminal row (half blocks).
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
  [...BODY, ...BOTH, GAP],
  [GAP, ...BODY, ...RIGHT_UP],
  [...BODY, ...BOTH, GAP],
]
// Resting: the same body and four legs as the mark, squatting one row lower, legs a row short.
// Walking: the squat again, the two leg pairs swinging apart and together.
const STRIDE_A = '.#.#....#.#.'
const STRIDE_B = '...#.##.#...'
const WALK: string[][] = [STRIDE_A, LEGS, STRIDE_B, LEGS].map(legs => [GAP, GAP, ...BODY, legs])
const REST: string[][] = [
  [GAP, GAP, ...BODY, LEGS],
  [GAP, GAP, ...SHUT, LEGS],
]

const PX: Record<string, string | undefined> = { '#': BODY_COLOR, E: DARK, e: BODY_COLOR, '.': undefined }

type Span = { text: string; fg?: string; bg?: string }

// Pairs pixel rows into terminal rows: top pixel as the upper half block, bottom as the lower.
const paint = (art: string[]): Span[][] => {
  const px = art.length % 2 ? [...art, GAP] : art
  const out: Span[][] = []
  for (let y = 0; y < px.length; y += 2) {
    const line: Span[] = []
    for (let x = 0; x < px[y].length; x++) {
      const a = px[y][x]
      const b = px[y + 1][x]
      const t = PX[a]
      const u = PX[b]
      const cell: { ch: string; fg?: string; bg?: string } =
        a === 'e' || b === 'e'
          ? { ch: '▁', fg: DARK, bg: BODY_COLOR }
          : t === u
            ? { ch: SP, bg: t }
            : !t
              ? { ch: '▄', fg: u }
              : !u
                ? { ch: '▀', fg: t }
                : { ch: '▀', fg: t, bg: u }
      const last = line[line.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
      else line.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
    }
    out.push(line)
  }
  return out
}

const CHAR_COLS = 12

// Widest offset the character may walk to; the render keeps it in step with the pane width.
let limit = 0

// One random step: stand still, start walking either way, turn around, or stop and hold for a few ticks.
const stepPos = (p: { x: number; dir: number; hold: number }, max: number, speed: number) => {
  let { dir } = p
  const x = Math.min(p.x, max)
  if (p.hold > 0) return { x, dir: 0, hold: p.hold - 1 }
  const r = Math.random()
  if (dir === 0) {
    if (r >= 0.5) return { x, dir: 0, hold: 0 }
    dir = Math.random() < 0.5 ? -1 : 1
  } else if (r < 0.15) return { x, dir: 0, hold: 1 + Math.floor(Math.random() * 5) }
  else if (r < 0.25) dir = -dir
  let nx = x + dir * speed
  if (nx < 0 || nx > max) {
    dir = -dir
    nx = x + dir * speed
  }
  return { x: Math.min(max, Math.max(0, nx)), dir, hold: 0 }
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
        if (isBusy || n % 3 === 0) {
          void update($, tick, t => t + 1)
          void update($, pos, p => stepPos(p, limit, isBusy ? 2 : 1))
        }
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
    const walker = await read($, pos)
    const art = isBusy ? STOMP[t % STOMP.length] : walker.dir !== 0 ? WALK[t % WALK.length] : REST[t % REST.length]
    const bodyRows = (e.props as { scroll?: { bodyRows?: number } } | undefined)?.scroll?.bodyRows
    const room = Math.max(8, bodyRows ?? (e.viewport?.rows ?? 24) - 4)
    const visible = Math.max(3, room - 1 - CHAR_ROWS - 3)
    const start = Math.min(await read($, top), Math.max(0, list.length - visible))
    const bodyCols = (e.props as { bodyColumns?: number } | undefined)?.bodyColumns ?? cols
    limit = Math.max(0, bodyCols - 2 - CHAR_COLS)
    const offset = Math.min(walker.x, limit)
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
          {paint(art).map(row => (
            <Box flexWrap="nowrap" flexShrink={0}>
              <Text>{SP.repeat(1 + offset)}</Text>
              {row.map(r => (
                <Box flexShrink={0}>
                  <Text color={r.fg} backgroundColor={r.bg}>
                    {r.text}
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

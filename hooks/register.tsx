import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row } from '../types'
import { BUBBLE_COLS, CHAR_COLS, CHAR_ROWS, MOODS, SP, SPEED, bubble, frame, moodOf, paint, stepPos } from './crawl'
import type { Mood } from './crawl'

const PANE = 'omok-explorer'
const HIDDEN = new Set(['.git', '__pycache__', 'node_modules', '.omc'])
const open = atom({ plugin: 'omok-explorer', key: 'open' } as const, [] as string[])
const width = atom({ plugin: 'omok-explorer', key: 'width' } as const, 36)
const busy = atom({ plugin: 'omok-explorer', key: 'busy' } as const, false)
const tick = atom({ plugin: 'omok-explorer', key: 'tick' } as const, 0)
const top = atom({ plugin: 'omok-explorer', key: 'top' } as const, 0)
const pos = atom({ plugin: 'omok-explorer', key: 'pos' } as const, { x: 0, dir: 0, hold: 0 })
// What crawl is doing; `until` (clock ms) ends a passing mood such as error or done, 0 keeps it.
const mood = atom({ plugin: 'omok-explorer', key: 'mood' } as const, { mood: 'rest', until: 0 })
// A mood pinned with /crawl, or '' to follow Claude.
const pinned = atom({ plugin: 'omok-explorer', key: 'pinned' } as const, '')
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

const MIN_WIDTH = 28

// How long the passing moods last, in ms.
const ERROR_MS = 4000
const DONE_MS = 3500

// Widest offset the character may walk to; the render keeps it in step with the pane width.
let limit = 0

const moodNow = async ($: any): Promise<Mood> => {
  const pin = await read($, pinned)
  if (pin) return pin as Mood
  const m = await read($, mood)
  if (m.until && (await $.clock.now()) > m.until) return (await read($, busy)) ? 'think' : 'rest'
  return m.mood as Mood
}

const setMood = async ($: any, next: Mood, ms = 0) => {
  const t = ms ? (await $.clock.now()) + ms : 0
  await update($, mood, () => ({ mood: next, until: t }))
}

const show = async ($: any) => {
  const columns = await read($, width)
  return $.ui.open({ id: PANE, title: 'Explorer', columns })
}

let timer: { cancel: () => void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'explorer', description: 'Open the /omok file explorer pane' })
    await $.command.register({
      name: 'crawl',
      description: 'Pin crawl to one move, or follow Claude again',
      argumentHint: `[${MOODS.join('|')}|auto]`,
    })
    await refresh($)
    void show($)
    timer?.cancel()
    let n = 0
    timer = $.clock.every(300, () => {
      n += 1
      void Promise.all([read($, busy), moodNow($)]).then(([isBusy, m]) => {
        if (isBusy || m !== 'rest' || n % 3 === 0) {
          void update($, tick, t => t + 1)
          if (SPEED[m] > 0) void update($, pos, p => stepPos(p, limit, SPEED[m], m !== 'rest'))
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
    await setMood($, 'think')
    return next(e)
  })

  // Each tool call sets crawl's move; a failed call makes it dizzy for a moment.
  on('tool.call', async ($, e, next) => {
    const started = moodOf(e.tool)
    await setMood($, started)
    const ran = await next(e)
    // Outside a turn (background work, or a straggler after an abort) crawl goes back to rest,
    // unless something else has taken over since.
    if (!(await read($, busy))) {
      if ((await read($, mood)).mood === started) await setMood($, 'rest')
      return ran
    }
    if (ran.deny === undefined && ran.isError === true) await setMood($, 'error', ERROR_MS)
    else await setMood($, 'think')
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await update($, busy, () => false)
    // A failure still on show finishes before anything else.
    if ((await moodNow($)) === 'error') return done
    if (e.reason === 'answer') await setMood($, 'done', DONE_MS)
    else if (e.reason === 'error') await setMood($, 'error', ERROR_MS)
    else await setMood($, 'rest')
    return done
  })

  on('command.run', { command: 'crawl' }, async ($, e) => {
    const want = e.args.trim()
    if (!want || want === 'auto') {
      await update($, pinned, () => '')
      return { text: 'crawl follows Claude again.' }
    }
    if (!(MOODS as string[]).includes(want)) return { text: `crawl knows: ${MOODS.join(', ')}, auto.` }
    await update($, pinned, () => want)
    return { text: `crawl: ${want}` }
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

    const t = await read($, tick)
    const walker = await read($, pos)
    const m = await moodNow($)
    // Resting crawl that is on the move walks with the reading gait.
    const art = frame(m === 'rest' && walker.dir !== 0 ? 'read' : m, t, walker.dir)
    const say = bubble(m, t)
    const bodyRows = (e.props as { scroll?: { bodyRows?: number } } | undefined)?.scroll?.bodyRows
    const room = Math.max(8, bodyRows ?? (e.viewport?.rows ?? 24) - 4)
    const visible = Math.max(3, room - 1 - CHAR_ROWS - 3)
    const start = Math.min(await read($, top), Math.max(0, list.length - visible))
    const bodyCols = (e.props as { bodyColumns?: number } | undefined)?.bodyColumns ?? cols
    limit = Math.max(0, bodyCols - 2 - CHAR_COLS - BUBBLE_COLS)
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
          {paint(art).map((row, i) => (
            <Box flexWrap="nowrap" flexShrink={0}>
              <Text>{SP.repeat(1 + offset)}</Text>
              {row.map(r => (
                <Box flexShrink={0}>
                  <Text color={r.fg} backgroundColor={r.bg}>
                    {r.text}
                  </Text>
                </Box>
              ))}
              {i === 0 && (
                <Box flexShrink={0}>
                  <Text bold>{say}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

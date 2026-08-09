import { constants, PerformanceObserver } from 'perf_hooks'

/**
 * A periodic line of what the process is actually costing: collections since the
 * last line, time spent in them, and where the heap sits.  The C# demo prints the
 * same table from the CLR's GC counters - this is the V8 equivalent, and it exists
 * for the same reason: a number you can only trust if you have a baseline to compare
 * it against.
 *
 * That baseline is `skeleton` mode, where nothing but the session layer is running.
 * Run it, then run `reset` with the same --heap-every, and the difference between
 * the two is the application rather than the engine.
 *
 * Kinds map onto V8's collector, not the CLR's generations: minor is scavenge (new
 * space), major is a full mark-compact, incremental is a step of one.  Weak callback
 * processing is reported by Node under the same event and is deliberately not
 * counted here - it is not a collection.
 */

interface GcTally {
  minor: number
  major: number
  incremental: number
  pauseMs: number
}

function emptyTally (): GcTally {
  return { minor: 0, major: 0, incremental: 0, pauseMs: 0 }
}

function add (target: GcTally, other: GcTally): void {
  target.minor += other.minor
  target.major += other.major
  target.incremental += other.incremental
  target.pauseMs += other.pauseMs
}

function mb (bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

function elapsed (fromMs: number): string {
  const seconds = Math.round((Date.now() - fromMs) / 1000)
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0')
  const ss = (seconds % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

/** column widths, applied to both the header and the rows so the two line up */
const width = { time: 5, counts: [5, 6, 6], pause: 9, memory: [9, 9], delta: 10 }

function row (time: string, counts: string[], pause: string, memory: string[], delta: string): string {
  const pad = (values: string[], widths: number[]): string =>
    values.map((v, i) => v.padStart(widths[i])).join(' ')
  return `  [heap] ${time.padStart(width.time)} │ ${pad(counts, width.counts)} │ ` +
    `${pause.padStart(width.pause)} │ ${pad(memory, width.memory)} │ ${delta.padStart(width.delta)}`
}

function divider (): string {
  const span = (widths: number[]): string => '─'.repeat(widths.reduce((a, b) => a + b + 1, 1))
  return `  ${'─'.repeat(8 + width.time)}┼${span(width.counts)}┼${span([width.pause])}┼` +
    `${span(width.memory)}┼${'─'.repeat(width.delta + 1)}`
}

/**
 * @param intervalSeconds how often to print a row, 0 or less to print nothing
 */
export function startHeapReport (intervalSeconds: number): void {
  if (intervalSeconds <= 0) return

  let sinceLastRow = emptyTally()
  const total = emptyTally()

  const observer = new PerformanceObserver(list => {
    list.getEntries().forEach(entry => {
      const kind = (entry as { detail?: { kind?: number } }).detail?.kind
      switch (kind) {
        case constants.NODE_PERFORMANCE_GC_MINOR: sinceLastRow.minor++; break
        case constants.NODE_PERFORMANCE_GC_MAJOR: sinceLastRow.major++; break
        case constants.NODE_PERFORMANCE_GC_INCREMENTAL: sinceLastRow.incremental++; break
        // NODE_PERFORMANCE_GC_WEAKCB is weak callback processing, not a collection
        default: return
      }
      sinceLastRow.pauseMs += entry.duration
    })
  })
  observer.observe({ entryTypes: ['gc'] })

  const started = Date.now()
  let lastHeapUsed = process.memoryUsage().heapUsed

  console.log('')
  console.log(`  heap report every ${intervalSeconds}s - collections are since the previous row`)
  console.log(row('time', ['minor', 'major', 'incr'], 'gc pause', ['rss', 'heap'], 'heap Δ'))
  console.log(divider())

  const handle = setInterval(() => {
    const tally = sinceLastRow
    sinceLastRow = emptyTally()
    add(total, tally)

    const usage = process.memoryUsage()
    const deltaKb = Math.round((usage.heapUsed - lastHeapUsed) / 1024)
    lastHeapUsed = usage.heapUsed

    console.log(row(
      elapsed(started),
      [`+${tally.minor}`, `+${tally.major}`, `+${tally.incremental}`],
      `${tally.pauseMs.toFixed(1)} ms`,
      [`${mb(usage.rss)} MB`, `${mb(usage.heapUsed)} MB`],
      `${deltaKb >= 0 ? '+' : ''}${deltaKb} KB`))
  }, intervalSeconds * 1000)
  // the report must never be the reason the process is still alive
  handle.unref()

  process.on('exit', () => {
    const usage = process.memoryUsage()
    console.log('')
    console.log(`  [heap] after ${elapsed(started)}: ` +
      `${total.minor} minor, ${total.major} major, ${total.incremental} incremental, ` +
      `${total.pauseMs.toFixed(1)} ms in gc, rss ${mb(usage.rss)} MB, heap ${mb(usage.heapUsed)} MB`)
  })
}

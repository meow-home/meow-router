// Minimal append-only file logger for the Electron main process.
//
// The gateway and provider adapters log through `console`, which is invisible
// in a packaged Windows app (no attached console). That made upstream failures
// undiagnosable: the Antigravity adapter logged the real 400 body
// ("Function call is missing a thought_signature in functionCall parts") only
// to a console nobody could read, while the persisted `request_usage` row kept
// the generic "Antigravity request rejected.".
//
// This logger mirrors those lines to a file under the app data directory so a
// failure can be diagnosed after the fact. It never throws: a logging failure
// must not break a request. Callers must not pass credentials, authorization
// headers or request bodies (see AGENTS.md).

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface FileLoggerOptions {
  filePath: string
  /** Injectable clock so tests get deterministic timestamps. */
  now?: () => Date
}

export interface FileLogger {
  // `log` mirrors console.log so the logger satisfies the Console-shaped
  // dependency the provider adapters and QuotaService accept.
  log(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function serialize(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return ''
  try {
    return ' ' + JSON.stringify(meta)
  } catch {
    // A circular or otherwise unserializable meta must not lose the message.
    return ' [unserializable meta]'
  }
}

export function createFileLogger(opts: FileLoggerOptions): FileLogger {
  const now = opts.now ?? (() => new Date())
  let dirReady = false

  const write = (level: Level, msg: string, meta?: Record<string, unknown>): void => {
    try {
      if (!dirReady) {
        mkdirSync(dirname(opts.filePath), { recursive: true })
        dirReady = true
      }
      appendFileSync(opts.filePath, `${now().toISOString()} [${level}] ${msg}${serialize(meta)}\n`)
    } catch {
      // Logging is best-effort: never let it break the caller.
    }
  }

  return {
    log: (msg, meta) => write('INFO', msg, meta),
    info: (msg, meta) => write('INFO', msg, meta),
    warn: (msg, meta) => write('WARN', msg, meta),
    error: (msg, meta) => write('ERROR', msg, meta)
  }
}

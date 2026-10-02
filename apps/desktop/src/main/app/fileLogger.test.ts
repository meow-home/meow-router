import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileLogger } from './fileLogger'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meow-log-'))
  file = join(dir, 'meow-gateway.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createFileLogger', () => {
  it('appends one line per call with level, message and metadata', () => {
    const logger = createFileLogger({ filePath: file, now: () => new Date('2026-10-02T16:15:58.000Z') })
    logger.warn('non-ok status 400', { base: 'https://daily-cloudcode-pa.googleapis.com', body: 'Function call is missing a thought_signature' })
    logger.info('request', { requestId: 'r1' })

    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('2026-10-02T16:15:58.000Z')
    expect(lines[0]).toContain('[WARN]')
    expect(lines[0]).toContain('non-ok status 400')
    expect(lines[0]).toContain('Function call is missing a thought_signature')
    expect(lines[1]).toContain('[INFO]')
    expect(lines[1]).toContain('request')
  })

  it('exposes `log` so it satisfies the Console-shaped logger the adapters expect', () => {
    const logger = createFileLogger({ filePath: file })
    logger.log('[antigravity] non-ok status 400', { body: 'missing thought_signature' })
    const line = readFileSync(file, 'utf8')
    expect(line).toContain('[INFO]')
    expect(line).toContain('non-ok status 400')
    expect(line).toContain('missing thought_signature')
  })

  it('creates the parent directory when it does not exist yet', () => {
    const nested = join(dir, 'a', 'b', 'gateway.log')
    const logger = createFileLogger({ filePath: nested })
    logger.error('boom', { code: 'CLIENT_ERROR' })
    expect(readFileSync(nested, 'utf8')).toContain('boom')
  })

  it('never throws when the log path is unwritable (logging must not break requests)', () => {
    // A directory used as the log file path makes every write fail.
    const logger = createFileLogger({ filePath: dir })
    expect(() => logger.warn('still fine')).not.toThrow()
  })
})

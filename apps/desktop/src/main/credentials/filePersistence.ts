// File-backed persistence for encrypted credential bytes.
//
// Stores each ref as a small binary file under `app.getPath('userData')/credentials/`.
// Only ever persists the ENCRYPTED bytes produced by safeStorage — never plaintext.
// These files are NOT the SQLite database, so credentials never touch SQLite.

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialPersistence } from './safeStorageStore'

export class FileCredentialPersistence implements CredentialPersistence {
  constructor(private readonly dir: string) {}

  private fileFor(ref: string): string {
    // Refs are already validated to contain only [\w.:/-], so they are safe to
    // use directly as filenames after a small escaping pass.
    const safe = ref.replace(/[^a-zA-Z0-9._-]/g, '_')
    return join(this.dir, `${safe}.bin`)
  }

  async set(ref: string, value: Uint8Array): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.fileFor(ref), Buffer.from(value))
  }

  async get(ref: string): Promise<Uint8Array | null> {
    const file = this.fileFor(ref)
    if (!existsSync(file)) return null
    return readFileSync(file)
  }

  async delete(ref: string): Promise<void> {
    const file = this.fileFor(ref)
    if (existsSync(file)) rmSync(file, { force: true })
  }

  async has(ref: string): Promise<boolean> {
    return existsSync(this.fileFor(ref))
  }
}

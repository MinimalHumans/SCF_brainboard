/*
 * gen-licenses-desktop.mjs — regenerate public/licenses-desktop.json from the
 * Tauri/Rust dependency tree (src-tauri/Cargo.lock).
 *
 * Requires `cargo-license` (cargo install cargo-license). Runs `cargo license`
 * against src-tauri, drops the workspace crate itself and build/dev-only
 * dependencies (they don't ship in the compiled binary), and writes a JSON
 * asset the About popover fetches at runtime — only ever loaded when running
 * inside the desktop app (see src/utils/platform.ts).
 *
 * The full license *texts* for whatever SPDX identifiers show up here are
 * hand-maintained in src/config/licensesDesktop.ts, not generated — Cargo
 * doesn't ship each crate's full license text the way npm packages do.
 *
 *   node scripts/gen-licenses-desktop.mjs
 *
 * Re-run after any src-tauri/Cargo.toml dependency add/remove/upgrade.
 * Also runs automatically before `npm run desktop:build`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_TAURI = join(ROOT, 'src-tauri')
const OUT = join(ROOT, 'public/licenses-desktop.json')

if (!existsSync(join(SRC_TAURI, 'Cargo.toml'))) {
  console.error('✗ src-tauri/Cargo.toml not found — is the Tauri scaffold present?')
  process.exit(1)
}

const cargoToml = readFileSync(join(SRC_TAURI, 'Cargo.toml'), 'utf8')
const workspaceName = cargoToml.match(/^name\s*=\s*"([^"]+)"/m)?.[1]

let raw
try {
  raw = execFileSync(
    'cargo',
    ['license', '--json', '--avoid-dev-deps', '--avoid-build-deps'],
    { cwd: SRC_TAURI, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 },
  )
} catch (err) {
  console.error('✗ `cargo license` failed — install it with `cargo install cargo-license`.')
  console.error(err.message)
  process.exit(1)
}

const crates = JSON.parse(raw)
  .filter((c) => c.name !== workspaceName)
  .map((c) => ({
    name: c.name,
    version: c.version,
    license: c.license ?? 'UNKNOWN',
    authors: (c.authors ?? '')
      .split('|')
      .map((a) => a.trim())
      .filter(Boolean)
      .join(', '),
    url: c.repository || `https://crates.io/crates/${c.name}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Every distinct license *token* referenced (an expression like
// "Apache-2.0 OR MIT" is split into its alternatives) — used to sanity-check
// against the hand-maintained texts in licensesDesktop.ts.
const KNOWN_TOKENS = new Set([
  'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib',
  'Unicode-3.0', 'MPL-2.0', '0BSD', 'CC0-1.0', 'Unlicense', 'LGPL-2.1-or-later',
])
const tokenize = (expr) =>
  expr
    .replace(/\(|\)/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((t) => t.replace(/\s+WITH\s+.+$/i, '').trim())

const unknown = new Set()
for (const c of crates) {
  if (c.license === 'UNKNOWN') { unknown.add(`${c.name} (no license field)`); continue }
  for (const token of tokenize(c.license)) {
    if (!KNOWN_TOKENS.has(token)) unknown.add(`${c.name}: ${token}`)
  }
}
if (unknown.size) {
  console.warn('⚠ license tokens with no bundled text in licensesDesktop.ts:')
  for (const u of unknown) console.warn(`  - ${u}`)
}

writeFileSync(OUT, JSON.stringify(crates, null, 2) + '\n')
console.log(`✓ wrote ${OUT} — ${crates.length} crates`)

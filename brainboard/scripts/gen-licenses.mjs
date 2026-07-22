/*
 * gen-licenses.mjs — regenerate src/config/licenses.ts from the installed
 * dependency tree.
 *
 * Walks package-lock.json for every non-dev package, reads each package's
 * LICENSE file (falling back to the `license`/`author` fields when a package
 * ships none), and emits a typed data module the About popover renders.
 *
 * Type-only packages (@types/*, csstype) are excluded — they contribute no
 * code to the shipped bundle, so they carry no distribution obligation.
 *
 *   node scripts/gen-licenses.mjs
 *
 * Re-run after any dependency add/remove/upgrade.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/config/licenses.ts')

const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const direct = new Set(Object.keys(pkg.dependencies ?? {}))

// Type-only: ship .d.ts, never reach the bundle.
const EXCLUDE = (name) => name.startsWith('@types/') || name === 'csstype'

const findLicenseFile = (dir) => {
  if (!existsSync(dir)) return null
  const hit = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f))
  return hit ? join(dir, hit) : null
}

const extractCopyright = (text, fallbackAuthor) => {
  if (text) {
    // Every line that looks like a copyright statement — some packages
    // (marked) carry more than one holder, and all of them must be
    // reproduced. Fontsource LICENSE files cram each font file's notice onto
    // a single line, so trim at the first per-file repeat.
    // Match only genuine notices — "Copyright (c) X", "Copyright © X",
    // "Copyright 2016 X" — not prose inside the license body that happens to
    // contain the word ("COPYRIGHT HOLDERS BE LIABLE...", "Copyright Holder.").
    const lines = [...new Set(
      text
        .split('\n')
        .filter((l) => /^\s*copyright\s+(\(c\)|\u00a9|\d)/i.test(l))
        .map((l) => l.split(/(?<=\))\s+\S+\.(?:ttf|woff2?):/)[0].trim().replace(/\s+/g, ' ')),
    )]
    if (lines.length) return lines.join('\n')
  }
  return fallbackAuthor ? `Copyright (c) ${fallbackAuthor}` : ''
}

const repoUrl = (meta, name) => {
  const r = meta.repository
  const raw = typeof r === 'string' ? r : r?.url
  if (raw) {
    const cleaned = raw
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/\.git$/, '')
    // npm allows `user/repo` and `github:user/repo` shorthand (nanoid uses it).
    if (!/^https?:\/\//.test(cleaned)) {
      return `https://github.com/${cleaned.replace(/^github:/, '')}`
    }
    return cleaned
  }
  return `https://www.npmjs.com/package/${name}`
}

const packages = []
let oflText = null

for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev || !path.startsWith('node_modules/')) continue
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  if (EXCLUDE(name)) continue

  const dir = join(ROOT, path)
  const metaPath = join(dir, 'package.json')
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {}
  const licFile = findLicenseFile(dir)
  const licText = licFile ? readFileSync(licFile, 'utf8') : null

  const author =
    typeof meta.author === 'string' ? meta.author : meta.author?.name ?? null

  const license = entry.license ?? meta.license ?? 'UNKNOWN'

  if (license === 'OFL-1.1' && licText && !oflText) {
    // Strip the package-specific copyright header; keep the license body,
    // which is byte-identical across OFL fonts.
    const marker = licText.indexOf('-----------------------------------------------------------')
    oflText = licText.slice(marker).trim()
  }

  packages.push({
    name,
    version: entry.version ?? meta.version ?? '',
    license,
    copyright: extractCopyright(licText, author),
    url: repoUrl(meta, name),
    direct: direct.has(name),
  })
}

packages.sort((a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name))

const unknown = packages.filter((p) => p.license === 'UNKNOWN' || !p.copyright)
if (unknown.length) {
  console.warn('⚠ missing license/copyright data:', unknown.map((p) => p.name).join(', '))
}

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const banner = `/*
 * licenses.ts — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node scripts/gen-licenses.mjs
 *
 * Third-party packages bundled into the shipped app, with the copyright
 * notices their licenses require us to reproduce. Dev-only tooling (Vite,
 * TypeScript, ESLint) is omitted — it never reaches the bundle — as are
 * type-only packages.
 *
 * Generated ${new Date().toISOString().slice(0, 10)} against package-lock.json.
 */`

const body = `${banner}

export type LicenseId = ${[...new Set(packages.map((p) => p.license))]
  .map((l) => `'${l}'`)
  .join(' | ')}

export interface ThirdPartyPackage {
  /** npm package name. */
  name:      string
  /** Version resolved in package-lock.json at generation time. */
  version:   string
  license:   LicenseId
  /** Verbatim copyright line from the package's LICENSE file. */
  copyright: string
  url:       string
  /** true for packages listed in our own package.json dependencies. */
  direct:    boolean
}

export const THIRD_PARTY: ThirdPartyPackage[] = ${JSON.stringify(packages, null, 2)
  .replace(/^(\s*)"([a-zA-Z]+)":/gm, '$1$2:')}

/**
 * License bodies, stored once and paired with each package's own copyright
 * line at render time. Both MIT and OFL-1.1 require the notice and the
 * license text to travel with the distributed work.
 */
export const LICENSE_TEXTS: Record<LicenseId, string> = {
  'MIT': ${JSON.stringify(MIT_BODY)},
  'OFL-1.1': ${JSON.stringify(oflText ?? '')},
}

export const LICENSE_NAMES: Record<LicenseId, string> = {
  'MIT': 'MIT License',
  'OFL-1.1': 'SIL Open Font License 1.1',
}
`

writeFileSync(OUT, body)
console.log(`✓ wrote ${OUT} — ${packages.length} packages (${packages.filter((p) => p.direct).length} direct)`)

// Builds docs/guide.html from docs/guide.md — the hand-out for a reviewer.
//
//   npm run docs           write docs/guide.html
//   npm run docs:check     fail when the HTML is stale or the version stamps drift
//
// One source (the Markdown), one generated artefact (committed, so the colleague
// can open it without a toolchain). Images under docs/img are inlined, so the
// page is self-contained.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { marked } from 'marked'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(join(root, path), 'utf8')

const version = JSON.parse(read('package.json')).version
const guide = read('docs/guide.md')
const features = read('docs/features.md')
const out = join(root, 'docs/guide.html')
const check = process.argv.includes('--check')

// Both pages name the version they describe; a release that forgets one fails
// here rather than in front of the colleague.
const stamps = [
  ['docs/guide.md', guide],
  ['docs/features.md', features],
].filter(([, text]) => !text.includes(version))

if (stamps.length > 0) {
  console.error(`docs: version ${version} is not mentioned in ${stamps.map(([p]) => p).join(', ')}`)
  process.exit(1)
}

const inlineImages = html =>
  html.replace(/src="(?!https?:|data:)([^"]+)"/g, (whole, src) => {
    // Guide-relative first (docs/), then docs/img, so the Markdown can say
    // img/window.png and stay readable.
    const candidates = [join(root, 'docs', src), join(root, src)]
    const found = candidates.find(path => existsSync(path))
    if (found === undefined) return whole
    const mime = found.endsWith('.png') ? 'image/png' : found.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return `src="data:${mime};base64,${readFileSync(found).toString('base64')}"`
  })

const page = html => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kwdiff ${version} — the guide</title>
<style>
  :root {
    --ink: #1c1f24;
    --dim: #5c6570;
    --line: #dcd8d0;
    --paper: #fbfaf7;
    --accent: #1f6f3a;
    --code: #f1eee8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem 4rem;
    background: var(--paper);
    color: var(--ink);
    font: 17px/1.65 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 46rem; margin: 0 auto; }
  .stamp {
    display: flex; justify-content: space-between; gap: 1rem;
    border-bottom: 2px solid var(--ink);
    padding-bottom: .5rem; margin-bottom: 2.5rem;
    font: 500 13px/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace;
    letter-spacing: .02em; text-transform: uppercase; color: var(--dim);
  }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 1.5rem; letter-spacing: -.01em; }
  h2 {
    font-size: 1.25rem; margin: 2.75rem 0 .75rem;
    padding-top: 1.25rem; border-top: 1px solid var(--line);
  }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 .5rem; }
  p { margin: 0 0 1rem; }
  em { color: var(--dim); }
  a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  strong { font-weight: 600; }
  code {
    font: 0.88em ui-monospace, "Cascadia Mono", Consolas, monospace;
    background: var(--code); padding: .1em .35em; border-radius: 4px;
  }
  pre {
    background: #14171c; color: #e6edf3; padding: 1rem 1.1rem;
    border-radius: 8px; overflow-x: auto; font-size: .85rem; line-height: 1.55;
  }
  pre code { background: none; padding: 0; color: inherit; font-size: 1em; }
  table { border-collapse: collapse; width: 100%; margin: 1.25rem 0 1.5rem; font-size: .95rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
  ul, ol { padding-left: 1.25rem; margin: 0 0 1rem; }
  li { margin: .25rem 0; }
  img {
    max-width: 100%; height: auto; display: block; margin: 1.5rem 0;
    border: 1px solid var(--line); border-radius: 6px;
  }
  blockquote {
    margin: 1.25rem 0; padding: .25rem 0 .25rem 1rem;
    border-left: 3px solid var(--accent); color: var(--dim);
  }
  footer {
    margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--line);
    font-size: .85rem; color: var(--dim);
  }
  @media print {
    body { padding: 0; background: white; font-size: 11pt; }
    h2 { break-after: avoid; }
    table, img, pre { break-inside: avoid; }
    footer { display: none; }
  }
</style>
</head>
<body>
<main>
<div class="stamp"><span>kwdiff ${version}</span><span>the guide</span></div>
${inlineImages(marked.parse(guide, { gfm: true }))}
<footer>Generated from <code>docs/guide.md</code> — edit that file, then
<code>npm run docs</code>. The complete capability list is
<code>docs/features.md</code>.</footer>
</main>
</body>
</html>
`

const html = page(guide)

if (check) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (current !== html) {
    console.error('docs: docs/guide.html is out of date — run `npm run docs`')
    process.exit(1)
  }
  console.log(`docs: guide.html matches docs/guide.md (kwdiff ${version})`)
} else {
  writeFileSync(out, html)
  console.log(`docs: wrote docs/guide.html (${(html.length / 1024).toFixed(1)} kB, kwdiff ${version})`)
}

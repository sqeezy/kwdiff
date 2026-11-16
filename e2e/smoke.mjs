// kwdiff smoke e2e: drives the real Tauri window through tauri-driver.
//
//   node e2e/smoke.mjs
//
// Needs tauri-driver and msedgedriver on PATH (or TAURI_DRIVER / MSEDGEDRIVER),
// and a built app (npm run tauri build). No test framework: a session, a few
// assertions, a non-zero exit code. On Windows the whole thing has to run in
// the interactive desktop session — a scheduled task with /IT, or `npm run e2e`
// from a terminal.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BASE = 'http://127.0.0.1:4444'
const APP =
  process.env.KWDIFF_APP ??
  join(process.cwd(), 'src-tauri', 'target', 'release', 'kwdiff.exe')
const NATIVE = process.env.MSEDGEDRIVER ?? 'msedgedriver.exe'
const DRIVER = process.env.TAURI_DRIVER ?? 'tauri-driver'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? `  (${detail})` : ''}`)
  }
}

async function http(path, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const json = text.length === 0 ? {} : JSON.parse(text)
  if (!response.ok) {
    const message = json?.value?.message ? JSON.stringify(json.value) : text
    throw new Error(`${method} ${path} -> ${response.status}: ${message}`)
  }
  return json.value
}

const KEYS = {
  Tab: '\uE004',
  Enter: '\uE007',
  Escape: '\uE00C',
  PageDown: '\uE00F',
  PageUp: '\uE00E',
  Down: '\uE015',
  Up: '\uE016',
  Space: ' ',
}

async function main() {
  if (!existsSync(APP)) throw new Error(`app not built: ${APP}`)

  const driver = spawn(DRIVER, ['--native-driver', NATIVE], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  driver.stderr.on('data', data => {
    const line = String(data)
    if (line.includes('error')) console.error(`[tauri-driver] ${line.trim()}`)
  })

  try {
    let up = false
    for (let attempt = 0; attempt < 40 && !up; attempt += 1) {
      try {
        await http('/status')
        up = true
      } catch {
        await sleep(250)
      }
    }
    if (!up) throw new Error(`tauri-driver did not answer on ${BASE}`)

    const session = await http('/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'wry',
          'tauri:options': { application: APP },
        },
      },
    })
    const sid = session.sessionId
    const exec = script => http(`/session/${sid}/execute/sync`, 'POST', { script, args: [] })

    // The window opens, reads its config, spawns git and debounces a search:
    // assertions have to wait for state instead of assuming it.
    const waitFor = async (script, ok, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs
      let value
      while (Date.now() < deadline) {
        value = await exec(script)
        if (ok(value)) return value
        await sleep(300)
      }
      return value
    }

    const press = async key => {
      const value = KEYS[key] ?? key
      await http(`/session/${sid}/actions`, 'POST', {
        actions: [
          {
            type: 'key',
            id: 'kbd',
            actions: [
              { type: 'keyDown', value },
              { type: 'keyUp', value },
            ],
          },
        ],
      })
    }

    // 1. The window opened and the commit list is populated (config points at
    //    the bench repository, so the app opens it on launch).
    const rows = await waitFor(
      'return document.querySelectorAll("#commit-list li").length',
      value => value > 0,
    )
    check('commit list is populated', rows > 0, `rows=${rows}`)

    // 2. Narrow to a commit whose patch is taller than the pane, so the
    //    scrolling assertion below can mean something. "Pierre" matches the
    //    commit that added the viewer; its patch is ~200 lines.
    const search = await http(`/session/${sid}/element`, 'POST', {
      using: 'css selector',
      value: '#kw-search',
    })
    await http(`/session/${sid}/element/${search['element-6066-11e4-a52e-4f735466cecf']}/value`, 'POST', {
      text: 'Pierre',
    })
    const filtered = await waitFor(
      'return document.querySelectorAll("#commit-list li").length',
      value => value === 1,
    )
    check('search narrows the list', filtered >= 1 && filtered < rows, `rows=${filtered}`)

    // Tab is suppressed while the field has focus, Escape leaves the field.
    await press('Escape')
    await press('Tab')
    await press('Space')
    await sleep(400)
    const ticked = await waitFor(
      'return document.querySelectorAll("[role=checkbox][aria-checked=true]").length',
      value => value >= 1,
    )
    check('space ticks a commit', ticked >= 1, `ticked=${ticked}`)

    // 3. The patch reached the pane.
    const patchLength = await waitFor(
      'return (document.getElementById("diff-pane")?.textContent ?? "").length',
      value => value > 40,
    )
    check('patch rendered', patchLength > 40, `chars=${patchLength}`)

    // 4. One scroller, and it scrolls. This is the regression that cost three
    //    releases: a nested scroll container cannot keep the scrollbar honest.
    const nested = await exec(`
      const pane = document.getElementById("diff-pane");
      if (!pane) return -1;
      let count = 0;
      const walk = el => {
        const cs = getComputedStyle(el);
        if (el !== pane && (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) count += 1;
        [...el.children].forEach(walk);
      };
      walk(pane);
      return count;
    `)
    check('no nested scroller inside the diff pane', nested === 0, `nested=${nested}`)

    const overflow = await exec(`
      const pane = document.getElementById("diff-pane");
      return pane ? pane.scrollHeight > pane.clientHeight + 20 : false;
    `)
    check('the chosen patch overflows its pane', overflow === true, `overflow=${overflow}`)

    // Tab advances one pane, but the focus itself arrives from a Command: wait
    // for each pane to actually hold it, or PageDown scrolls whatever the
    // browser had focused and the assertion flakes (first seen on the 0.3.0
    // bench run, focus=file-list).
    const activeId =
      'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "none"'
    await press('Tab')
    await waitFor(activeId, value => value === 'file-list', 5000)
    await press('Tab')
    const focus = await waitFor(activeId, value => value === 'diff-pane', 5000)
    console.log(`     focus before PageDown: ${focus}`)
    check('tab reaches the diff pane', focus === 'diff-pane', `focus=${focus}`)

    await press('PageDown')
    await sleep(300)
    const scrolled = await waitFor(
      'return document.getElementById("diff-pane")?.scrollTop ?? -1',
      value => value > 0,
      5000,
    )
    check('PageDown scrolls the patch', scrolled > 0, `scrollTop=${scrolled}`)

    // 5. Two-endpoint compare: two refs in the two slots are `git diff A B`,
    //    a tree diff that needs no common ancestor, in the same panes. The
    //    ticks are kept (not applied) while it is on.
    const refs = await exec(
      'return [...document.querySelectorAll("#compare-from option")].map(o => o.value).filter(v => v !== "")',
    )
    check(
      'the compare slots list every ref',
      Array.isArray(refs) && refs.length >= 2,
      `refs=${Array.isArray(refs) ? refs.length : refs}`,
    )
    const fromRef = refs.includes('main') ? 'main' : refs[0]
    // A tag is the safest second endpoint: it cannot quietly equal main after a
    // push, and it is the oldest tree on the bench.
    const toRef =
      refs.includes('v0.1.0') && fromRef !== 'v0.1.0'
        ? 'v0.1.0'
        : (refs.find(name => name !== fromRef) ?? '')

    // A field is a controlled input: set the value, then dispatch the event
    // Foldkit listens to, and read it back.
    const setField = (selector, value) =>
      exec(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return "missing";
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return el.value;
      `)

    const clickOn = selector =>
      exec(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      `)

    const choose = (slot, value) => setField(`#compare-${slot}`, value)

    await choose('from', fromRef)
    await choose('to', toRef)

    const chip = await waitFor(
      'return document.getElementById("compare-chip") !== null',
      value => value === true,
      5000,
    )
    check('two endpoints put the window in compare mode', chip === true)

    const keptTicks = await exec(
      'return document.querySelectorAll("[role=checkbox][aria-checked=true]").length',
    )
    check('the ticks survive the compare', keptTicks >= 1, `ticked=${keptTicks}`)

    const note = await waitFor(
      'return document.getElementById("compare-note")?.textContent ?? ""',
      value => value.includes('→'),
      10000,
    )
    check('the note names both endpoints', note === `${fromRef} → ${toRef}`, `note=${note}`)

    const compareFiles = await waitFor(
      'return document.querySelectorAll("#file-list li").length',
      value => value > 0,
      20000,
    )
    check('the tree diff fills the file list', compareFiles > 0, `files=${compareFiles}`)

    // The header is the two endpoints as chosen; waiting for it also proves the
    // pane is not still showing the ticked commit's patch.
    const compareHeader = await waitFor(
      'return (document.getElementById("diff-pane")?.textContent ?? "").slice(0, 80)',
      value => value.startsWith(`# ${fromRef} → ${toRef}`),
      20000,
    )
    check(
      'the patch is the two endpoints, not the tick',
      compareHeader.startsWith(`# ${fromRef} → ${toRef}`),
      `header=${JSON.stringify(compareHeader.slice(0, 40))}`,
    )

    const treeDiff = await exec(
      'return (document.getElementById("diff-pane")?.textContent ?? "").includes("diff --git")',
    )
    check('the compare renders a real git diff', treeDiff === true)

    await choose('to', '')
    const cleared = await waitFor(
      'return document.getElementById("compare-note") === null',
      value => value === true,
      5000,
    )
    check('clearing a slot returns to the ticks', cleared === true)

    const backToTicks = await waitFor(
      'return (document.getElementById("diff-pane")?.textContent ?? "").startsWith("# ")',
      value => value === true,
      20000,
    )
    check('the ticked patch is back in the pane', backToTicks === true)

    // 6. Filters are `git log`'s own limits, so they have to reach git: an
    //    author narrows, a literal is not a pattern, regex makes it one again.
    await setField('#kw-search', '')
    const everything = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value > 10,
      20000,
    )
    check('clearing the keyword lists the history', everything > 10, `rows=${everything}`)

    await clickOn('#filters-toggle')
    const filterRow = await waitFor(
      'return document.getElementById("filter-row") !== null',
      value => value === true,
      5000,
    )
    check('the filter row opens', filterRow === true)

    const caret = await waitFor(
      'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "none"',
      value => value === 'filter-author',
      5000,
    )
    check('the row takes the caret', caret === 'filter-author', `focus=${caret}`)

    // The bench repository has both an Anton Herzog and dependabot commits.
    await setField('#filter-author', 'dependabot')
    const byAuthor = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value > 0 && value < everything,
      20000,
    )
    check(
      'an author filter narrows the list',
      byAuthor > 0 && byAuthor < everything,
      `rows=${byAuthor} of ${everything}`,
    )

    // No author contains "|" literally: without regex this cannot match.
    // Count ticks, not <li>s: a list with no matches still carries the
    // "no match" message as one <li>.
    await setField('#filter-author', 'anton|dependabot')
    const literal = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value === 0,
      20000,
    )
    check('without regex the author is a literal', literal === 0, `rows=${literal}`)

    await clickOn('#filter-regex')
    const asPattern = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value === everything,
      20000,
    )
    check('regex makes it a pattern', asPattern === everything, `rows=${asPattern} of ${everything}`)

    const badge = await exec('return document.getElementById("filters-toggle")?.textContent ?? ""')
    check('the button counts the active filter', badge.includes('2'), `button=${badge}`)

    await clickOn('#filter-clear')
    const clearedFilters = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value === everything,
      20000,
    )
    check(
      'clear restores the list',
      clearedFilters === everything,
      `rows=${clearedFilters} of ${everything}`,
    )
    await clickOn('#filters-toggle')

    // 7. ? opens the keymap (it is read from a raw keydown listener, because
    //    the binding table's shift matching misses it on some layouts).
    await press('Escape')
    await press('?')
    await sleep(300)
    const keymap = await waitFor(
      'return document.querySelector("[role=dialog][aria-label=\\"Keyboard shortcuts\\"]") !== null',
      value => value === true,
      5000,
    )
    check('? opens the keymap', keymap === true)

    await http(`/session/${sid}`, 'DELETE')
  } finally {
    driver.kill()
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => {
  console.error(`e2e could not run: ${error.message}`)
  process.exit(2)
})

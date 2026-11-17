// kwdiff smoke e2e: drives the real Tauri window through tauri-driver.
//
//   node e2e/smoke.mjs
//
// Needs tauri-driver and msedgedriver on PATH (or TAURI_DRIVER / MSEDGEDRIVER),
// git on PATH, and a built app (npm run tauri build). No test framework: a
// session, a few assertions, a non-zero exit code. On Windows the whole thing
// has to run in the interactive desktop session — a scheduled task with /IT, or
// `npm run e2e` from a terminal.
//
// The app is pointed at a repository this script builds from nothing, so a run
// means the same thing on a bench VM, on a CI runner and on a laptop: no
// checkout, clone depth or existing config can change the outcome.
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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

// ---- the repository under test ---------------------------------------------
//
// Built here, every run: two authors (one is dependabot, so the author filter
// has something to narrow to), a tag two commits behind, more than ten commits,
// and one commit whose src/app.ts patch has three hunks and is taller than the
// pane. Nothing about a run depends on which clone or config the machine has.
const git = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...env } })

const ANTON = { GIT_AUTHOR_NAME: 'Anton Herzog', GIT_AUTHOR_EMAIL: 'anton@example.com' }
const BOT = {
  GIT_AUTHOR_NAME: 'dependabot[bot]',
  GIT_AUTHOR_EMAIL: '49699333+dependabot[bot]@users.noreply.github.com',
}

const fixtureRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kwdiff-e2e-'))
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Anton Herzog'])
  git(dir, ['config', 'user.email', 'anton@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])

  const write = (path, lines) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), `${lines.join('\n')}\n`)
  }
  const commit = (subject, date, author = ANTON, body = null) => {
    git(dir, ['add', '-A'])
    const message = body === null ? ['-m', subject] : ['-m', subject, '-m', body]
    git(dir, ['commit', '-q', ...message], {
      ...author,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    })
  }

  const app = Array.from({ length: 60 }, (_, i) => `export const route${i} = () => '/r/${i}'`)
  write('src/app.ts', app)
  write('src/ui.ts', ['export const view = () => null'])
  write('package.json', ['{', '  "name": "fixture",', '  "version": "0.1.0"', '}'])
  write('README.md', ['# fixture'])
  commit('chore: initial layout', '2026-01-05T09:00:00')
  git(dir, ['tag', 'v0.1.0'])

  for (let i = 1; i <= 10; i += 1) {
    write(`src/feature-${i}.ts`, [`export const feature${i} = () => ${i}`])
    commit(`feat: feature ${i}`, `2026-01-${String(5 + i).padStart(2, '0')}T09:00:00`)
  }

  // Past the pane's 5 000-line cap, so a run can see the notice and expand it.
  write('vendor/table.ts', Array.from({ length: 6000 }, (_, i) => `export const row${i} = ${i}`))
  commit('chore: vendor the lookup table', '2026-01-17T12:00:00')

  write('src/http/retry.ts', ['export const retry = () => 1'])
  commit('fix: retry once on gateway 502', '2026-01-16T09:00:00')

  write('package.json', ['{', '  "name": "fixture",', '  "version": "0.1.1"', '}'])
  commit('chore(deps): bump effect to 4.1.4', '2026-01-17T09:00:00', BOT)

  const taller = app.map((line, i) =>
    i === 4 ? "export const route4 = () => '/changed/4'" : i === 29 ? '// moved' : line,
  )
  // The needle lives in the last hunk (the append), so a code search should
  // open app.ts there and not at line 1.
  taller.push(
    ...Array.from({ length: 200 }, (_, i) =>
      i === 150 ? '// needle-in-a-changed-line' : `export const extra${i} = ${i}`,
    ),
  )
  write('src/app.ts', taller)
  write('src/ui.ts', ['export const view = () => "pierre"'])
  commit("feat: render the patch with Pierre's CodeView", '2026-01-18T09:00:00', ANTON, [
    'The pane needs a viewer that owns its scroll position.',
    '',
    '- one scroller',
    '- one owner',
    '- one highlight',
  ].join('\n'))

  return dir
}

// The app opens `last` on launch: point it at the fixture, in the app-data dir
// the release build uses, with forward slashes as the app writes them.
const seedConfig = repo => {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const dir = join(appData, 'dev.sqeezy.kwdiff')
  mkdirSync(dir, { recursive: true })
  const path = repo.split('\\').join('/')
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ recents: [path], last: path, branches: [] }, null, 2),
  )
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

  const repo = fixtureRepo()
  seedConfig(repo)
  console.log(`     fixture repository: ${repo}`)

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

    // Starting the session is the one step that fails for reasons that are not
    // the app's: msedgedriver sometimes cannot find the DevTools port of a
    // freshly launched WebView2 (`DevToolsActivePort file doesn't exist`). That
    // is a retry, not a red build — the assertions below are not retried.
    const openSession = async () => {
      let lastError
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          return await http('/session', 'POST', {
            capabilities: {
              alwaysMatch: {
                browserName: 'wry',
                'tauri:options': { application: APP },
              },
            },
          })
        } catch (error) {
          lastError = error
          console.log(
            `     session attempt ${attempt} failed: ${String(error.message).split('\n')[0]}`,
          )
          await sleep(8000)
        }
      }
      throw lastError
    }

    const session = await openSession()
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

    // The body strip: the ticked commit's message, collapsed until asked.
    const bodyText = await waitFor(
      'return document.getElementById("commit-body")?.textContent ?? ""',
      value => value.includes('The pane needs a viewer'),
      10000,
    )
    check(
      'the ticked commit shows its message body',
      bodyText.includes('The pane needs a viewer'),
      `body=${JSON.stringify(bodyText.slice(0, 40))}`,
    )
    const moreButton = await exec('return document.getElementById("body-toggle") !== null')
    check('a longer body offers more', moreButton === true)

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

    // 5. Inside the diff: a file click loads that file's patch, arrows scroll
    //    lines without stepping hunks, n/p step hunks. The active hunk is the
    //    model's hunkIndex as the view paints it.
    const activeIdScript =
      'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "none"'
    const hunkState = `
      const hunks = [...document.querySelectorAll('[id^="hunk-"]')];
      return {
        count: hunks.length,
        active: hunks.findIndex(el => (el.getAttribute("class") || "").includes("1d3350")),
        top: document.getElementById("diff-pane")?.scrollTop ?? -1,
      };
    `

    const appFile = await exec(`
      const rows = [...document.querySelectorAll("#file-list li")];
      const index = rows.findIndex(li => (li.textContent || "").includes("app.ts"));
      if (index < 0) return -1;
      rows[index].querySelector("button").click();
      return index;
    `)
    check('the ticked commit has an app.ts file to click', appFile >= 0, `index=${appFile}`)
    const appPatch = await waitFor(
      'return (document.getElementById("diff-pane")?.textContent ?? "").includes("diff --git a/src/app.ts")',
      value => value === true,
      20000,
    )
    check('clicking a file loads its patch', appPatch === true)

    const hunks = await waitFor(
      'return document.querySelectorAll(\'[id^="hunk-"]\').length',
      value => value >= 2,
      20000,
    )
    check('the file has more than one hunk', hunks >= 2, `hunks=${hunks}`)

    // The gutter numbers come from the hunk header, so they must start where it
    // says: `@@ -a,b +N,c @@` means the first added line is N.
    const gutter = await exec(`
      const pane = document.getElementById("diff-pane");
      if (!pane) return null;
      const header = (pane.textContent || "").match(/@@ -\\d+(?:,\\d+)? \\+(\\d+)/);
      const numbered = [...pane.querySelectorAll("[data-new]")]
        .map(el => el.getAttribute("data-new"))
        .filter(value => value !== null)
        .map(value => Number(value));
      return {
        header: header ? Number(header[1]) : null,
        first: numbered.length ? Number(numbered[0]) : null,
      };
    `)
    check(
      'the gutter starts at the hunk header',
      gutter !== null && gutter.header !== null && gutter.header === gutter.first,
      `header=${gutter?.header} gutter=${gutter?.first}`,
    )

    // A click moved focus onto the file row; Tab from the diff focuses the pane.
    await press('Tab')
    const paneFocus = await waitFor(activeIdScript, value => value === 'diff-pane', 5000)
    check('the diff pane holds focus', paneFocus === 'diff-pane', `focus=${paneFocus}`)

    const beforeLine = await exec('return document.getElementById("diff-pane")?.scrollTop ?? -1')
    await press('Down')
    await sleep(250)
    const afterLine = await exec('return document.getElementById("diff-pane")?.scrollTop ?? -1')
    check(
      'an arrow scrolls about one line',
      afterLine > beforeLine && afterLine - beforeLine <= 40,
      `scrollTop ${beforeLine} → ${afterLine}`,
    )

    const stillFirst = await exec(hunkState)
    check('arrows do not step hunks', stillFirst.active === 0, `active=${stillFirst.active}`)

    await press('n')
    const afterN = await waitFor(hunkState, value => value?.active === 1, 5000)
    check('n steps to the next hunk', afterN.active === 1, `active=${afterN.active} of ${afterN.count}`)

    await press('p')
    const afterP = await waitFor(hunkState, value => value?.active === 0, 5000)
    check('p steps back', afterP.active === 0, `active=${afterP.active}`)

    // Escape walks the panes back: diff → files → commits → out of the field.
    await press('Escape')
    const backToFiles = await waitFor(activeIdScript, value => value === 'file-list', 5000)
    check('escape walks back to the files', backToFiles === 'file-list', `focus=${backToFiles}`)
    await press('Escape')
    const backToCommits = await waitFor(activeIdScript, value => value === 'commit-list', 5000)
    check('escape walks back to the commits', backToCommits === 'commit-list', `focus=${backToCommits}`)
    await press('Escape')
    const backToSearch = await waitFor(activeIdScript, value => value === 'kw-search', 5000)
    check('escape walks back to the search field', backToSearch === 'kw-search', `focus=${backToSearch}`)
    await press('Escape')
    const outOfField = await waitFor(activeIdScript, value => value === 'BODY', 5000)
    check('a second escape leaves the field', outOfField === 'BODY', `focus=${outOfField}`)

    // 6. Two-endpoint compare: two refs in the two slots are `git diff A B`,
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

    // 7. Search-to-hunk: `-a` matched a changed line, so the patch opens at the
    //    hunk that matched and the file that contains it is marked.
    await clickOn('#code-toggle')
    await setField('#kw-search', 'needle-in-a-changed-line')
    const byCode = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value === 1,
      20000,
    )
    check('a code search narrows to the commit', byCode === 1, `rows=${byCode}`)

    // The needle travels with a *selection* load, so tick the commit off and on
    // again; a search alone does not reload the patch.
    await clickOn('#commit-list li button')
    await waitFor(
      'return document.querySelectorAll("#file-list li").length',
      value => value === 0,
      10000,
    )
    await clickOn('#commit-list li button')

    const matchedFile = await waitFor(
      'return document.querySelectorAll("#file-list [aria-label=\'the code search matched a changed line here\']").length',
      value => value >= 1,
      20000,
    )
    check('the file list marks the file that matched', matchedFile >= 1, `marked=${matchedFile}`)

    const jumped = await waitFor(
      'return (() => { const hunks = [...document.querySelectorAll(\'[id^="hunk-"]\')]; return hunks.findIndex(el => (el.getAttribute("class") || "").includes("1d3350")); })()',
      value => value === 2,
      20000,
    )
    check('the patch opens at the hunk that matched', jumped === 2, `active=${jumped}`)

    // 8. Switching repositories from the top bar.
    await clickOn('#repos-toggle')
    const reposRow = await waitFor(
      'return document.getElementById("repos-row") !== null',
      value => value === true,
      5000,
    )
    check('the top bar opens the repository row', reposRow === true)

    const currentRepo = await exec(
      'return (document.getElementById("repos-row")?.textContent ?? "").includes("kwdiff-e2e-")',
    )
    check('the row lists the current repository', currentRepo === true)

    await clickOn('#recent-0')
    const reposClosed = await waitFor(
      'return document.getElementById("repos-row") === null',
      value => value === true,
      5000,
    )
    check('choosing a repository closes the row', reposClosed === true)

    const repopulated = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value >= 1,
      20000,
    )
    check('the reopened repository lists commits', repopulated >= 1, `rows=${repopulated}`)

    // 9. A patch past the cap says so and can be shown whole.
    await setField('#kw-search', 'vendor the lookup table')
    // Wait for the row itself, not for a count: the previous keyword also had
    // exactly one row, so a count passes before the new search lands.
    const vendorRow = await waitFor(
      'return [...document.querySelectorAll("#commit-list li")].some(li => (li.textContent || "").includes("vendor the lookup table"))',
      value => value === true,
      20000,
    )
    check('the vendored commit is found', vendorRow === true)
    await clickOn('#commit-list li button')
    // The file list arrives after the tick; open the vendored file explicitly.
    const tableReady = await waitFor(
      'return [...document.querySelectorAll("#file-list li")].some(li => (li.textContent || "").includes("table.ts"))',
      value => value === true,
      20000,
    )
    check('the vendored file is in the list', tableReady === true)
    await exec(`
      const rows = [...document.querySelectorAll("#file-list li")];
      const row = rows.find(li => (li.textContent || "").includes("table.ts"));
      if (row) row.querySelector("button").click();
    `)
    const cappedBar = await waitFor(
      'return document.getElementById("patch-cap")?.textContent ?? ""',
      value => value.includes('first'),
      30000,
    )
    check(
      'a patch past 5 000 lines says what it hides',
      cappedBar.includes('first') && cappedBar.includes('6'),
      `bar=${JSON.stringify(cappedBar.slice(0, 48))}`,
    )
    await clickOn('#patch-cap-toggle')
    const expandedBar = await waitFor(
      'return document.getElementById("patch-cap")?.textContent ?? ""',
      value => value.includes('all'),
      30000,
    )
    check('show all renders the rest', expandedBar.includes('all'), `bar=${expandedBar.slice(0, 24)}`)

    // 10. Refresh: the window re-reads git and the list survives it.
    await press('r')
    await sleep(600)
    const refreshed = await waitFor(
      'return document.querySelectorAll("#commit-list [role=checkbox]").length',
      value => value >= 1,
      20000,
    )
    check('refresh keeps a populated list', refreshed >= 1, `rows=${refreshed}`)

    // 11. The two keys a reviewer presses first: `/` to the search field, and
    //    `enter` one pane deeper.
    await press('/')
    const searchFocus = await waitFor(
      'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "none"',
      value => value === 'kw-search',
      5000,
    )
    check('slash focuses the search field', searchFocus === 'kw-search', `focus=${searchFocus}`)

    await press('Enter')
    const entered = await waitFor(
      'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "none"',
      value => value === 'commit-list',
      5000,
    )
    check('enter walks one pane deeper', entered === 'commit-list', `focus=${entered}`)

    // 12. ? opens the keymap (it is read from a raw keydown listener, because
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
    if (failures === 0) {
      // Best effort: the app may still be shutting down and holding the folder
      // (Windows then answers EBUSY). A leftover temp dir is not a test failure.
      try {
        rmSync(repo, { recursive: true, force: true })
      } catch {
        console.log(`     left the fixture behind: ${repo}`)
      }
    }
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => {
  console.error(`e2e could not run: ${error.message}`)
  process.exit(2)
})

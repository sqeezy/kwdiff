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
    const rows = await exec(
      'return document.querySelectorAll("#commit-list li").length',
    )
    check('commit list is populated', rows > 0, `rows=${rows}`)

    // 2. Keyboard: tab into the commits pane, space ticks the first commit.
    await press('Tab')
    await press('Space')
    await sleep(400)
    const ticked = await exec(
      'return document.querySelectorAll("[role=checkbox][aria-checked=true]").length',
    )
    check('space ticks a commit', ticked >= 1, `ticked=${ticked}`)

    // 3. The patch reached the pane.
    const patchLength = await exec(
      'return (document.getElementById("diff-pane")?.textContent ?? "").length',
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

    await press('Tab')
    await press('Tab')
    await press('PageDown')
    await sleep(300)
    const scrolled = await exec(
      'return document.getElementById("diff-pane")?.scrollTop ?? -1',
    )
    check('PageDown scrolls the patch', scrolled > 0, `scrollTop=${scrolled}`)

    // 5. ? opens the keymap (it is read from a raw keydown listener, because
    //    the binding table's shift matching misses it on some layouts).
    await press('Escape')
    await press('?')
    await sleep(300)
    const keymap = await exec(
      'return document.querySelector("[role=dialog][aria-label=\\"Keyboard shortcuts\\"]") !== null',
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

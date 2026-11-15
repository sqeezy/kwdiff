# e2e

One smoke test over the real window, through `tauri-driver` and WebDriver.
No test framework: a session, assertions, a non-zero exit code.

```sh
npm run tauri build            # the app under test
npm run e2e                    # or: node e2e/smoke.mjs
```

Needs `tauri-driver` (`cargo install tauri-driver`) and a `msedgedriver.exe`
matching the installed WebView2 version. Override with `TAURI_DRIVER`,
`MSEDGEDRIVER` or `KWDIFF_APP`.

**Windows needs an interactive desktop session.** Run it from a terminal, or
from a scheduled task with `/IT`; from plain SSH the app cannot create a window.

What it checks, in order: the commit list is populated (the app opens the
repository in `%APPDATA%\dev.sqeezy.kwdiff\config.json`), `space` ticks a
commit, a patch reaches the pane, there is **no nested scroller** inside the
diff pane, `PageDown` moves `scrollTop`, and `?` opens the keymap.

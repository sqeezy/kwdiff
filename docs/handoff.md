# Handoff

Written 2026-11-15, at the end of the session that built v0.2.9. Everything here
is in the repo, in Linear, or on the bench machine — nothing lives only in a
chat.

## Where things stand

- **Shipped:** `v0.2.9`, a Windows desktop app: open a repository, search
  messages across every ref, tick commits across unrelated roots, read their
  patches. Installer ~1.3 MB, unsigned, on GitHub Releases.
- **Verified:** 26 story tests, `typecheck`, `vite build`, `tauri build`, and an
  **e2e smoke on the real window** (bench VM green, CI green).
- **Tracker:** Linear project [kwdiff](https://linear.app/sqeezy/project/kwdiff-5b66d62f8ee3),
  milestones `v1.0 — releasable`, `v1.1 — the review artifact`, `Later`.
- **Next ticket:** **ANT-66**, two-endpoint compare. Then ANT-64 (filters),
  ANT-60 (search-to-hunk), ANT-73 (line keys), ANT-74 (blocking e2e), ANT-62
  (advisories). `docs/roadmap.md` holds the order and the release criterion.

## Branches

- `main` — the app.
- `prototype/foldkit-gui` — the three-variant UI prototype that produced Variant
  B. Reference only, never merged.
- `plan/kwdiff-map` — the closed wayfinder map and its tickets.

## The bench

A Windows 11 VM, added to pi-phone as machine **`ai-worker`** (`bench@ai-worker`,
tailnet name resolves). It exists so nothing runs on the owner's own checkout
(`X:\Github\kwdiff` — **never touch it**).

- Bench clone: `C:\Bench\kwdiff` (full clone, not shallow — a `--depth` fetch
  reports its depth as the repository's history).
- Toolchain: git, Node 26, Rust (rustup), VS Build Tools at `C:\BuildTools`,
  WebView2, OpenSSH server, console auto-login as `bench`.
- `scripts/bench.ps1 reset|dev|tauri|stop -Path C:\Bench\kwdiff -Port 1421`
  (needs `-ExecutionPolicy Bypass` on a fresh Windows).
- Vite on **1421**, app identifier `dev.sqeezy.kwdiff.bench`, so a bench build
  never fights the installed app for a window, a port or a config file.

### Driving the window

ocu only sees the console session; SSH lands in session 0. A scheduled task with
`/IT` bridges it:

```
scripts/bench-ocu.ps1        # { "tool": "get_app_state", "args": { "app": "kwdiff" } }
                             # or { "calls": [ … ] } to chain, which keeps element indices valid
```

Gotchas that cost time: JSON travels as files, never argv (`schtasks` quoting);
PowerShell 5.1 drops embedded quotes calling native exes, so the call goes
through a generated `.bat`; `PageDown` is not a valid ocu key (`Down`, `Tab`,
`Return` are); a `[string]` parameter shadows any variable of the same name.

pi-phone's own `computer_control setup task: install` is broken on Windows — see
ANT-72 (the harness above is the workaround).

## e2e

```
npm run tauri build && npm run e2e
```

`e2e/smoke.mjs` spawns `tauri-driver` with an msedgedriver matching WebView2,
opens a session against the built exe and asserts: commit list populated, search
narrows, `space` ticks, a patch arrives, **no nested scroller in the diff pane**,
the patch overflows, `PageDown` moves `scrollTop`, `?` opens the keymap. Needs an
interactive desktop session. CI runs it (currently `continue-on-error`).

## Open decisions

1. **Two-endpoint compare in v1.0 or after?** It sits in v1.0 now because every
   competitor has it; the colleague's stated need (cross-root search) already
   works, so moving it to v1.1 would ship sooner.
2. **Review notes (ANT-69) still need a wayfinder map** before code: anchors,
   storage, document shape.
3. **ANT-72** needs an owner outside this repo (pi-phone's setup path).

## House rules

`AGENTS.md` has the ones a compiler cannot enforce: one Command per dispatch,
`execute` shape for Commands with and without args, staleness ids, Rust owns
config, never `makeApplication`, keys clear of WebView2 accelerators, and the
bench-is-not-your-checkout rule.

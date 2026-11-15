# Linear import

The tracker moves to a fresh Linear project; the repo keeps the specification
and the closed wayfinder map as history. This file is the issue set to create,
in order, with the reason each exists. Delete it once Linear is the live
tracker.

Project: **kwdiff** — "Review patches across branches with no common ancestor".

## Now

1. **Verify the diff pane on a real machine** — the v0.2.1 blank-pane report.
   Repro on a Windows install: open a repository, type a keyword, tick a
   commit, expect the patch. If still empty, the pane now prints git's message.
2. **Two-endpoint compare** — "what changed between these two tips". A two-slot
   picker beside the keyword field; reuse `files`, `patch`, `roots` with
   `git diff A B`. The most asked review question and the only Tier-1 gap every
   competitor already fills ([landscape](../research/competitive-landscape.md)).
3. **Filters** — author, date range, path, regex, all pass-through to `git log`
   (`--author`, `--since`, `--regexp-ignore-case`, pathspec).
4. **Search-to-hunk** — when `-a` matched a line, open the patch at the hunk
   that matched instead of line 1.

## Next

5. **Notes and Markdown export** (wayfinder **map #2**) — anchors
   `(sha, path, side, line content)`, the fourth rail the grid reserves, a
   Markdown review as the artifact.
6. **Side-by-side and word-level diff** — presentation, after notes.
7. **Virtualise long patches** — the 5 000-line notice becomes a windowed list.
8. **Merge commits** — combined diff instead of first-parent only.
9. **Release signing and auto-update** — only if the colleague asks twice.

## Housekeeping

10. **Dependabot: two high advisories** in dev dependencies — bump or dismiss
    with a reason.

## Out of scope (do not re-open without a new destination)

Staging/committing/merging, commit graph, blame, PR hosting integration,
multi-repo tabs, plugins, i18n, macOS/Linux, telemetry. The closed map's
*Out of scope* section holds the reasoning.

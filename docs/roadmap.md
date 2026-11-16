# Roadmap

The live tracker is **Linear**, project [kwdiff](https://linear.app/sqeezy/project/kwdiff-5b66d62f8ee3).
Three milestones carry the order; this page says *why* that order and what "done"
means, so the repository still answers the question on its own.

## v1.0 — releasable (target 2026-11-30)

What the colleague needs to use kwdiff on a real repository, and what makes us
believe it works:

- the diff pane renders and scrolls on a real machine (done — ANT-61, verified
  by `npm run e2e` in the bench VM);
- **two-endpoint compare** (done 0.3.0, ANT-66): "what changed between these
  two tips" is the most asked review question and the one every competitor
  answers;
- **filters** (ANT-64): author, date, path, regex — `git log` already does it;
- **search-to-hunk** (ANT-60): `-a` matches should open where they matched;
- **diff pane line keys** (ANT-73): arrows scroll lines, `n`/`p` keep hunks;
- **the e2e gate is blocking** (ANT-74), with hunk-navigation assertions;
- **range selection** (done 0.2.10): shift-click selects anchor → row,
  shift+arrow extends it, a plain click toggles and moves the anchor;
- no known high advisories (ANT-62).

Release criterion: `npm run e2e` green on the bench VM **and** in CI, the
installer from CI runs on the colleague's machine, and the issues above are
closed. Anything else is post-v1.

Two-endpoint compare **stays in v1.0** (owner's call, 2026-11-15): the
colleague's cross-root search works, but "what changed between these tips" is
the question they ask next.

## v1.1 — the review artifact (target 2027-01-31)

The reading is done; the output starts to exist.

- **Review notes with Markdown export** (ANT-69) — the next wayfinder map, with
  anchors `(sha, path, side, line content)` and the fourth rail the grid
  reserves;
- **richer diff rendering** (ANT-71) — syntax colour and split view, done without
  repeating the CodeView lesson: one scroll owner, or ours with Shiki tokens.

## Later

Not on the way to a releasable tool: virtualisation (ANT-65), combined merge
diffs (ANT-68), signing and auto-update (ANT-67), the upstream pi-phone report
(ANT-72).

## Not in any milestone

Staging, committing, merging, commit graph, blame, PR hosting, multi-repo tabs,
plugins, i18n, macOS/Linux. The closed wayfinder map's *Out of scope* section
holds the reasoning; adding one of these is a new destination, not a ticket.

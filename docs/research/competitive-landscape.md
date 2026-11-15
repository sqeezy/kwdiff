# kwdiff in the landscape

What other tools do the same job, what kwdiff is missing, and where it is
genuinely alone. Two companion files hold the raw material with per-claim
sources: [desktop-clients.md](desktop-clients.md) (13 GUI clients, read
2026-11-15) and [cli-and-next-gen.md](cli-and-next-gen.md) (git, jj, Sapling,
stacked-review tools, viewers, hosted review).

## Verdict

**The cell kwdiff occupies is unclaimed: an arbitrary, ticked set of commits
from unrelated roots, read as one composed diff in a window.** Every neighbour
is one step away and blocked by its own model: git takes two endpoints or a
reachability range; jj takes a gap-free revset in a terminal; desktop clients
cap at two commits (or a contiguous range); hosted review is PR-framed by
construction. Nobody advertises what kwdiff does, and the reason is
architectural, not laziness.

## Who is where

| Capability | Who has it | Who does not |
|---|---|---|
| Diff two **arbitrary** commits, no ancestry | `git diff A B`; TortoiseGit, Git Extensions, SmartGit, Fork, GitLens, Git Graph, JetBrains (all 2-max) | GitHub PR default (three-dot), crucible/gerrit (base-framed) |
| Diff **N** commits at once | GitKraken, only when they are **consecutive**; `jj diff -r B::D` (gap-free revset); `git log --all -p` as a stream | every other GUI |
| N commits across **unrelated roots** | `jj` (roots work, gaps do not); kwdiff | everything else |
| **Search** messages across all refs | TortoiseGit, SmartGit, JetBrains, GitLens, Git Graph, `git log --all --grep` | GitHub Desktop, VS Code built-in |
| Search → **tick** → read that set | **kwdiff** | all of the above |
| Say *"these commits share no ancestor"* instead of failing | **kwdiff** (jj sidesteps the question) | all GUIs; `git diff A...B` dies with `fatal: no merge base` |
| Per-file **composition** of one file across several commits | **kwdiff** | CLIs emit N patch headers in a stream; editors group per commit |

Corrections the research forced on our own story, now fixed in the README:
`git diff A..B` **is** `git diff A B` — a tree diff that needs no merge base;
`git range-diff` needs none either. Only `A...B` and `--merge-base` need one.
What breaks in hosted tools is their **three-dot default**, and what breaks in
CLIs is that a *set* is not a range at all.

## Obvious missing things

**Tier 1 — table stakes, a reviewer notices within a minute**

1. **Two-endpoint compare.** "What changed between these two tips?" is the most
   asked question in review, every competitor answers it, and we cannot: the
   model only knows ticks. Cheap — `git diff A B`, the existing file list, a
   two-slot picker next to the keyword field.
2. **Filters.** Author, date range, path, regex. `git log` gives all of them
   for free; we expose one keyword and a branch. `--author`, `--since`,
   `--regexp-ignore-case`, pathspecs.
3. **Readable diff presentation.** Side-by-side toggle, word-level highlight,
   ignore-whitespace, rename detection, binary markers, syntax highlighting.
   Today it is one flat monospace stream; fine for reading, tiring for review.
4. **Search-to-hunk.** When `-a` matched a line, the patch opens at line 1 and
   the match is invisible. Jumping to the matching hunk is the difference
   between "found it" and "hunt for it".

**Tier 2 — the artifact**

5. **Notes and export** (map #2). Without them a review leaves no trace: you
   read, you close, you remember. This is the difference between a viewer and a
   review tool, and the fourth rail is already reserved for it.

**Tier 3 — scale and correctness**

6. **Virtualisation** for 5 000-line patches and long lists; the current answer
   is a notice.
7. **Merge commits** are shown against their first parent; a combined diff is
   what a reviewer of a merge wants.
8. **Selection-aware caps** — 2 000 commits is a wall with no "load more".

**Tier 4 — deliberately out of scope**

9. PR/host integration (GitHub, GitLab), multi-repo tabs, blame, history,
   staging. Each is a different product; the map's *Out of scope* says so.

## Where it is positioned well, and why

1. **Migration archaeology.** "What did we change for ABC-123 in the old SVN
   tree and in the git rewrite?" The two histories share no ancestor, so every
   range-shaped tool answers a different question or fails silently
   (`git log A..B` quietly lists *all* of B). kwdiff's answer is the only one
   that is both complete and legible.
2. **Backport and security verification.** The same fix landed on three
   unrelated forks or release branches. Reviewers compare patches by eye today.
   A ticked set with per-file composition is exactly the review.
3. **Vendor drops and third-party code.** Your integration branch versus a
   vendor history imported without common ancestry: same shape, no tool.
4. **The read-only guarantee.** No index, no checkout, no writes — so it is safe
   on a production checkout, a client's repository, or a read-only mount. Every
   VCS-native alternative (jj, Sapling, stacked tools) asks you to adopt a new
   VCS or workflow first.

**Why competitors cannot follow quickly.** TortoiseGit is a shell extension whose
multi-selection menu is defined for two revisions; Git Extensions and SmartGit
model selection as a comparison of two states; GitKraken's N-commit view is a
range; JetBrains multi-select is a tree compare. Adding "arbitrary set with
per-commit patches" changes their data model, not a menu item. GitHub and
GitLab are server-side and PR-framed by design. jj has the primitive but is a
VCS, terminal-only, and requires the repository to be colocated and adopted —
and it still cannot express a cherry-picked, gapped set.

## Three moves, in order

1. **Two-endpoint compare** (Tier 1.1): closes the "most asked question", reuses
   `files`/`patch`/`roots`, and needs one new Rust command.
2. **Filters + hunk jump** (Tier 1.2, 1.4): pure pass-through to `git log`, and
   the hunk jump is a scroll target we already have the ids for.
3. **Notes** (Tier 2): the first thing that makes the output outlive the
   session; already charted as map #2.

Presentation work (side-by-side, word-level) is worth doing *after* notes: it
changes how a patch reads, not what the tool is for.

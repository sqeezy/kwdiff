// The one imperative island in the app: Pierre's CodeView owns its own DOM
// (Shadow DOM, virtualised), so it cannot be rebuilt from the Model each render.
// A Mount creates it per patch, this module keeps the handle so the keyboard can
// scroll it.
import type { CodeView } from '@pierre/diffs'

let current: CodeView | null = null

export const setViewer = (view: CodeView | null): void => {
  current = view
}

let hunks: ReadonlyArray<Readonly<{ id: string; line: number }>> = []

// The pane is the scroll surface (the viewer renders full height inside it),
// so line scrolling talks to the pane element, not to anything in the shadow
// root.
export const scrollByLines = (delta: number): void => {
  const pane = document.getElementById('diff-pane')
  pane?.scrollBy({ top: delta * 24, behavior: 'instant' })
}

// Each hunk belongs to a file item (`f0`, `f1`, …) and an added-side line.
// Scroll targets need both; a bare line number means nothing to the viewer.
export const hunkTargets = (patch: string): ReadonlyArray<{ id: string; line: number }> => {
  const found: Array<{ id: string; line: number }> = []
  let file = -1
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git')) file += 1
    if (!text.startsWith('@@')) continue
    const match = /\+(\d+)/.exec(text)
    const line = match?.[1] === undefined ? 1 : Number(match[1])
    found.push({ id: `f${Math.max(file, 0)}`, line })
  }
  return found
}

export const setHunks = (patch: string | null): void => {
  hunks = patch === null ? [] : hunkTargets(patch)
}

export const hunkCount = (): number => hunks.length

export const scrollToHunk = (index: number): void => {
  const target = hunks[index]
  if (target === undefined) return
  current?.scrollTo({
    type: 'line',
    id: target.id,
    lineNumber: target.line,
    side: 'additions',
    behavior: 'instant',
    align: 'start',
  })
}

// Dev-only handle: the viewer lives in a shadow root, so the only way to see
// what the keyboard is talking to is to expose it. Stripped from production
// builds by the `import.meta.env.DEV` guard.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { __kwdiff: unknown }).__kwdiff = {
    hunkTargets,
    scrollToHunk,
    state: () => ({ hasView: current !== null, hunks }),
  }
}

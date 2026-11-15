// The one imperative island in the app: Pierre's CodeView owns its own DOM
// (Shadow DOM, virtualised), so it cannot be rebuilt from the Model each render.
// A Mount creates it per patch, this module keeps the handle so the keyboard can
// scroll it.
import type { CodeView } from '@pierre/diffs'

let current: CodeView | null = null

export const setViewer = (view: CodeView | null): void => {
  current = view
}

export const scrollToLine = (line: number): void => {
  current?.scrollTo({ type: 'line', id: 'f0', lineNumber: line, side: 'additions', behavior: 'smooth' })
}

// The added-side start line of every hunk, in order: what `n`/`p` walk.
export const hunkStartLines = (patch: string | null): ReadonlyArray<number> => {
  if (patch === null) return []
  const lines: number[] = []
  for (const text of patch.split('\n')) {
    if (!text.startsWith('@@')) continue
    const match = /\+(\d+)/.exec(text)
    if (match?.[1] !== undefined) lines.push(Number(match[1]))
  }
  return lines
}

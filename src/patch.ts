// Turning a patch into rows with line numbers: the diff pane's gutter.
//
// The numbers come from the hunk headers (`@@ -old,count +new,count @@`), which
// is why this is a pure function over the patch text and not a view concern.

export type PatchLine = Readonly<{
  kind: 'hunk' | 'meta' | 'add' | 'del' | 'context'
  /** Old-side number, for deleted lines and context. */
  oldLine: number | null
  /** New-side number, for added lines and context. */
  newLine: number | null
  text: string
}>

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const numberedLines = (patch: string): ReadonlyArray<PatchLine> => {
  const rows: PatchLine[] = []
  let old = 0
  let next = 0
  let inHunk = false
  const lines = patch.split('\n')

  for (const [index, text] of lines.entries()) {
    if (text.startsWith('@@')) {
      const match = HUNK.exec(text)
      if (match !== null) {
        old = Number(match[1])
        next = Number(match[2])
      }
      inHunk = true
      rows.push({ kind: 'hunk', oldLine: null, newLine: null, text })
      continue
    }
    // Before the first hunk there is no content: git separates the message from
    // the patch with a blank line, which is not a line of the file.
    if (!inHunk) {
      rows.push({ kind: 'meta', oldLine: null, newLine: null, text })
      continue
    }
    // File headers and index lines are not content: no number, no count.
    if (
      // The app's own `# <sha> <subject>` header, and git's "no newline" note.
      text.startsWith('#') ||
      text.startsWith('\\ ') ||
      text.startsWith('diff --git') ||
      text.startsWith('index ') ||
      text.startsWith('+++') ||
      text.startsWith('---') ||
      text.startsWith('new file mode') ||
      text.startsWith('deleted file mode') ||
      text.startsWith('similarity index') ||
      text.startsWith('rename ')
    ) {
      rows.push({ kind: 'meta', oldLine: null, newLine: null, text })
      continue
    }
    // The trailing empty string after the last newline is not a line.
    if (text === '' && index === lines.length - 1) {
      rows.push({ kind: 'meta', oldLine: null, newLine: null, text })
      continue
    }
    if (text.startsWith('+')) {
      rows.push({ kind: 'add', oldLine: null, newLine: next, text })
      next += 1
      continue
    }
    if (text.startsWith('-')) {
      rows.push({ kind: 'del', oldLine: old, newLine: null, text })
      old += 1
      continue
    }
    rows.push({ kind: 'context', oldLine: old, newLine: next, text })
    old += 1
    next += 1
  }

  return rows
}

// A very large patch is capped for the pane's sake — a generated file can run to
// tens of thousands of lines, and every line is two elements. The cap is shown
// and reversible: the pane says how many lines it is hiding, and *show all*
// renders the rest. Hiding without saying so would be worse than being slow.
export const PATCH_LINE_CAP = 5000

export const cappedRows = (
  rows: ReadonlyArray<PatchLine>,
  expanded: boolean,
): Readonly<{ rows: ReadonlyArray<PatchLine>; hidden: number }> =>
  expanded || rows.length <= PATCH_LINE_CAP
    ? { rows, hidden: 0 }
    : { rows: rows.slice(0, PATCH_LINE_CAP), hidden: rows.length - PATCH_LINE_CAP }

import { describe, expect, test } from 'vitest'

import { numberedLines } from '../src/patch'

describe('numberedLines', () => {
  test('numbers context, added and deleted lines across two hunks', () => {
    const patch = [
      'diff --git a/x.ts b/x.ts',
      'index 111..222 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,3 +10,4 @@',
      ' ctx',
      '-old',
      '+new',
      '+added',
      ' ctx2',
      '@@ -40,2 +41,2 @@',
      '-a',
      '+b',
    ].join('\n')

    expect(numberedLines(patch).map(row => [row.kind, row.oldLine, row.newLine])).toEqual([
      ['meta', null, null],
      ['meta', null, null],
      ['meta', null, null],
      ['meta', null, null],
      ['hunk', null, null],
      ['context', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['add', null, 12],
      ['context', 12, 13],
      ['hunk', null, null],
      ['del', 40, null],
      ['add', null, 41],
    ])
  })

  test('the blank line git puts between message and patch has no number', () => {
    const rows = numberedLines('# abc subject\n\ndiff --git a/x b/x\n@@ -1 +1 @@\n+x')
    expect(rows.map(row => [row.kind, row.newLine])).toEqual([
      ['meta', null],
      ['meta', null],
      ['meta', null],
      ['hunk', null],
      ['add', 1],
    ])
  })

  test('a hunk header without counts still starts numbering', () => {
    const rows = numberedLines('@@ -1 +1 @@\n+x')
    expect(rows.map(row => [row.kind, row.oldLine, row.newLine])).toEqual([
      ['hunk', null, null],
      ['add', null, 1],
    ])
  })

  test('a file with no trailing newline numbers its last line', () => {
    const rows = numberedLines('@@ -5,2 +5,2 @@\n same\n-old\n+new')
    expect(rows.at(-1)).toMatchObject({ kind: 'add', newLine: 6, text: '+new' })
  })

  test('a trailing newline adds no phantom number', () => {
    const rows = numberedLines('@@ -1 +1 @@\n+x\n')
    expect(rows.at(-1)).toMatchObject({ kind: 'meta', oldLine: null, newLine: null, text: '' })
  })

  test('the patch header and git notes carry no number', () => {
    const rows = numberedLines(
      '# e3f1a07 refactor: policy\ndiff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file',
    )
    expect(rows.map(row => [row.kind, row.newLine])).toEqual([
      ['meta', null],
      ['meta', null],
      ['hunk', null],
      ['del', null],
      ['add', 1],
      ['meta', null],
    ])
  })

  test('an empty patch is no rows', () => {
    expect(numberedLines('')).toHaveLength(1)
    expect(numberedLines('')[0]?.kind).toBe('meta')
  })
})

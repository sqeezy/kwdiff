// Fixture repository for the browser dev server and the tests. Same shapes the
// Rust side returns: two unrelated roots, one keyword on each, one file on both.
import type { Commit, Config, Endpoints, FilePatch, Filters, Ref, Repo, RootOf, SearchArgs } from './types'
import type { GitApi } from './git'

type Fixture = Readonly<{
  sha: string
  date: string
  author: string
  subject: string
  root: 'main' | 'legacy'
  branches: ReadonlyArray<string>
  files: ReadonlyArray<FilePatch & { patch: string }>
}>

const fixtures: ReadonlyArray<Fixture> = [
  {
    sha: 'c1a4f2e',
    date: '2019-04-12',
    author: 'Petra Lindqvist',
    subject: 'fix: retry once on gateway 502 (ABC-123)',
    root: 'legacy',
    branches: ['svn/legacy'],
    files: [
      {
        path: 'src/http/retry.ts',
        added: 13,
        removed: 3,
        isNew: false,
        patch: `@@ -10,7 +10,17 @@
 export const withRetry = <A>(effect) =>
   effect.pipe(
-    Effect.retry(Schedule.exponential('50 millis')),
+    Effect.retry(
+      Schedule.exponential('50 millis').pipe(
+        Schedule.whileInput((n: number) => n < 5),
+      ),
+    ),
+    Effect.tapError(error =>
+      Effect.sync(() => logWarn('retry.gateway', { error })),
+    ),
   )`,
      },
    ],
  },
  {
    sha: '8de01b3',
    date: '2019-05-03',
    author: 'Petra Lindqvist',
    subject: 'test: cover the 502 backoff path (ABC-123)',
    root: 'legacy',
    branches: ['svn/legacy'],
    files: [
      {
        path: 'src/http/retry.test.ts',
        added: 18,
        removed: 0,
        isNew: true,
        patch: `@@ -0,0 +1,18 @@
+import { describe, expect, it } from 'vitest'
+import { Effect } from 'effect'
+
+describe('withRetry', () => {
+  it('retries a 502 exactly once', async () => {
+    let calls = 0
+    const flaky = Effect.suspend(() => {
+      calls += 1
+      return calls === 1
+        ? Effect.fail(new GatewayError(502))
+        : Effect.succeed('ok')
+    })
+
+    expect(await Effect.runPromise(withRetry(flaky))).toBe('ok')
+    expect(calls).toBe(2)
+  })
+})`,
      },
    ],
  },
  {
    sha: '4b77c90',
    date: '2026-10-28',
    author: 'Bilal Özdemir',
    subject: 'feat: cache retry responses for 60s (ABC-123)',
    root: 'main',
    branches: ['main', 'release/4.2'],
    files: [
      {
        path: 'src/http/cache.ts',
        added: 14,
        removed: 0,
        isNew: true,
        patch: `@@ -0,0 +1,14 @@
+import { Cache, Duration } from 'effect'
+
+const gatewayCache = Effect.runSync(
+  Cache.make({ capacity: 512, timeToLive: Duration.seconds(60) }),
+)
+
+export const cachedRetry = (key: string, effect) =>
+  Effect.gen(function* () {
+    const hit = yield* Cache.get(gatewayCache, key)
+    if (hit._tag === 'Some') return hit.value
+    const value = yield* effect
+    yield* Cache.set(gatewayCache, key, value)
+    return value
+  })`,
      },
      {
        path: 'src/server.ts',
        added: 3,
        removed: 1,
        isNew: false,
        patch: `@@ -42,7 +42,9 @@
-  const orders = await fetchOrders(req.query)
+  const orders = await cachedRetry(
+    \`orders:\${req.query.cursor ?? 'head'}\`,
+    fetchOrders(req.query),
+  )
   res.json(orders)`,
      },
    ],
  },
  {
    sha: 'e3f1a07',
    date: '2026-11-02',
    author: 'Yuki Tanaka',
    subject: 'refactor: extract the backoff policy (ABC-123)',
    root: 'main',
    branches: ['main', 'release/4.2'],
    files: [
      {
        path: 'src/http/backoff.ts',
        added: 9,
        removed: 0,
        isNew: true,
        patch: `@@ -0,0 +1,9 @@
+import { Schedule } from 'effect'
+
+export const GATEWAY_ATTEMPTS = 5
+
+export const gatewayBackoff = Schedule.exponential('50 millis').pipe(
+  Schedule.whileInput((n: number) => n < GATEWAY_ATTEMPTS),
+  Schedule.jittered,
+)`,
      },
      {
        path: 'src/http/retry.ts',
        added: 2,
        removed: 11,
        isNew: false,
        patch: `@@ -1,16 +1,7 @@
-import { Effect, Schedule } from 'effect'
+import { Effect } from 'effect'
+import { gatewayBackoff } from './backoff'
 
 export const withRetry = <A>(effect) =>
-  effect.pipe(
-    Effect.retry(
-      Schedule.exponential('50 millis').pipe(
-        Schedule.whileInput((n: number) => n < 5),
-      ),
-    ),
-    Effect.tapError(error =>
-      Effect.sync(() => logWarn('retry.gateway', { error })),
-    ),
-  )
+  effect.pipe(Effect.retry(gatewayBackoff))`,
      },
    ],
  },
  {
    sha: '5f0c9ab',
    date: '2026-11-12',
    author: 'Yuki Tanaka',
    subject: 'feat: gateway matrix for the retry table',
    root: 'main',
    branches: ['main'],
    files: [
      {
        path: 'src/http/routes.ts',
        added: 62,
        removed: 0,
        isNew: true,
        patch: `@@ -0,0 +1,62 @@
+export const ROUTES = [
+  { route: '/v1/orders/1', retries: 1, timeout: 51 },
+  { route: '/v1/orders/2', retries: 2, timeout: 52 },
+  { route: '/v1/orders/3', retries: 3, timeout: 53 },
+  { route: '/v1/orders/4', retries: 4, timeout: 54 },
+  { route: '/v1/orders/5', retries: 0, timeout: 55 },
+  { route: '/v1/orders/6', retries: 1, timeout: 56 },
+  { route: '/v1/orders/7', retries: 2, timeout: 57 },
+  { route: '/v1/orders/8', retries: 3, timeout: 58 },
+  { route: '/v1/orders/9', retries: 4, timeout: 59 },
+  { route: '/v1/orders/10', retries: 0, timeout: 60 },
+  { route: '/v1/orders/11', retries: 1, timeout: 61 },
+  { route: '/v1/orders/12', retries: 2, timeout: 62 },
+  { route: '/v1/orders/13', retries: 3, timeout: 63 },
+  { route: '/v1/orders/14', retries: 4, timeout: 64 },
+  { route: '/v1/orders/15', retries: 0, timeout: 65 },
+  { route: '/v1/orders/16', retries: 1, timeout: 66 },
+  { route: '/v1/orders/17', retries: 2, timeout: 67 },
+  { route: '/v1/orders/18', retries: 3, timeout: 68 },
+  { route: '/v1/orders/19', retries: 4, timeout: 69 },
+  { route: '/v1/orders/20', retries: 0, timeout: 70 },
+  { route: '/v1/orders/21', retries: 1, timeout: 71 },
+  { route: '/v1/orders/22', retries: 2, timeout: 72 },
+  { route: '/v1/orders/23', retries: 3, timeout: 73 },
+  { route: '/v1/orders/24', retries: 4, timeout: 74 },
+  { route: '/v1/orders/25', retries: 0, timeout: 75 },
+  { route: '/v1/orders/26', retries: 1, timeout: 76 },
+  { route: '/v1/orders/27', retries: 2, timeout: 77 },
+  { route: '/v1/orders/28', retries: 3, timeout: 78 },
+  { route: '/v1/orders/29', retries: 4, timeout: 79 },
+  { route: '/v1/orders/30', retries: 0, timeout: 80 },
+  { route: '/v1/orders/31', retries: 1, timeout: 81 },
+  { route: '/v1/orders/32', retries: 2, timeout: 82 },
+  { route: '/v1/orders/33', retries: 3, timeout: 83 },
+  { route: '/v1/orders/34', retries: 4, timeout: 84 },
+  { route: '/v1/orders/35', retries: 0, timeout: 85 },
+  { route: '/v1/orders/36', retries: 1, timeout: 86 },
+  { route: '/v1/orders/37', retries: 2, timeout: 87 },
+  { route: '/v1/orders/38', retries: 3, timeout: 88 },
+  { route: '/v1/orders/39', retries: 4, timeout: 89 },
+  { route: '/v1/orders/40', retries: 0, timeout: 90 },
+  { route: '/v1/orders/41', retries: 1, timeout: 91 },
+  { route: '/v1/orders/42', retries: 2, timeout: 92 },
+  { route: '/v1/orders/43', retries: 3, timeout: 93 },
+  { route: '/v1/orders/44', retries: 4, timeout: 94 },
+  { route: '/v1/orders/45', retries: 0, timeout: 95 },
+  { route: '/v1/orders/46', retries: 1, timeout: 96 },
+  { route: '/v1/orders/47', retries: 2, timeout: 97 },
+  { route: '/v1/orders/48', retries: 3, timeout: 98 },
+  { route: '/v1/orders/49', retries: 4, timeout: 99 },
+  { route: '/v1/orders/50', retries: 0, timeout: 100 },
+  { route: '/v1/orders/51', retries: 1, timeout: 101 },
+  { route: '/v1/orders/52', retries: 2, timeout: 102 },
+  { route: '/v1/orders/53', retries: 3, timeout: 103 },
+  { route: '/v1/orders/54', retries: 4, timeout: 104 },
+  { route: '/v1/orders/55', retries: 0, timeout: 105 },
+  { route: '/v1/orders/56', retries: 1, timeout: 106 },
+  { route: '/v1/orders/57', retries: 2, timeout: 107 },
+  { route: '/v1/orders/58', retries: 3, timeout: 108 },
+  { route: '/v1/orders/59', retries: 4, timeout: 109 },
+  { route: '/v1/orders/60', retries: 0, timeout: 110 },
+]`,
      },
    ],
  },
  {
    sha: '77a90cd',
    date: '2026-09-30',
    author: 'Bilal Özdemir',
    subject: 'docs: explain why ranges need a merge base',
    root: 'main',
    branches: ['main'],
    files: [
      {
        path: 'docs/how-it-works.md',
        added: 6,
        removed: 2,
        isNew: false,
        patch: `@@ -18,8 +18,12 @@
-Only ranges need an ancestor.
+Only ranges need an ancestor:
+
+| command        | needs a merge base |
+| -------------- | ------------------ |
+| git diff A B   | no                 |
+| git diff A..B  | yes                |`,
      },
    ],
  },
  {
    sha: 'd9b2c41',
    date: '2019-06-21',
    author: 'Petra Lindqvist',
    subject: 'chore: drop tslint',
    root: 'legacy',
    branches: ['svn/legacy'],
    files: [
      {
        path: 'tslint.json',
        added: 0,
        removed: 6,
        isNew: false,
        patch: `@@ -1,6 +0,0 @@
-{
-  "extends": ["tslint:recommended"],
-  "rules": { "quotemark": [true, "single"] }
-}`,
      },
    ],
  },
]

const refs: ReadonlyArray<Ref> = [
  { name: 'main', kind: 'local' },
  { name: 'release/4.2', kind: 'local' },
  { name: 'svn/legacy', kind: 'local' },
  { name: 'origin/main', kind: 'remote' },
  { name: 'v0.1.0', kind: 'tag' },
]

const toCommit = (f: Fixture): Commit => ({
  sha: f.sha,
  date: f.date,
  author: f.author,
  subject: f.subject,
})

const newestFirst = (a: Fixture, b: Fixture) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// A tree at an endpoint: the latest patch for each path among the fixture
// commits that the endpoint names, by sha or by carrying its branch. The
// fixture has patches, not trees, so a compare here is the difference between
// two such maps — enough to drive the browser dev server, nothing more.
const treeAt = (endpoint: string): ReadonlyMap<string, FilePatch & { patch: string }> => {
  const commits = fixtures
    .filter(f => f.sha === endpoint || f.branches.includes(endpoint))
    .sort(newestFirst)
    .reverse()
  const tree = new Map<string, FilePatch & { patch: string }>()
  for (const commit of commits) {
    for (const file of commit.files) tree.set(file.path, file)
  }
  return tree
}

// `--grep` and `--author` are regular expressions unless the regex toggle is
// off, where both are literals.
const regex = (value: string): RegExp | null => {
  try {
    return new RegExp(value, 'i')
  } catch {
    return null
  }
}

const matchesFilters = (f: Fixture, filters: Filters): boolean => {
  const author = filters.author.trim().toLowerCase()
  if (author !== '' && !f.author.toLowerCase().includes(author)) return false
  const since = filters.since.trim()
  if (since !== '' && f.date < since) return false
  const until = filters.until.trim()
  if (until !== '' && f.date > until) return false
  // A pathspec, approximated: the fixture has no tree, only a file list.
  const path = filters.path.trim()
  if (path !== '' && !f.files.some(file => file.path.includes(path))) return false
  return true
}

const matchesKeyword = (f: Fixture, needle: string, code: boolean, filters: Filters): boolean => {
  if (needle === '') return true
  const pattern = filters.regex ? regex(needle) : null
  if (filters.regex && pattern === null) return false
  const inMessage = pattern === null
    ? f.subject.toLowerCase().includes(needle.toLowerCase())
    : pattern.test(f.subject)
  const inCode = code && f.files.some(file =>
    pattern === null
      ? file.patch.toLowerCase().includes(needle.toLowerCase())
      : pattern.test(file.patch),
  )
  return inMessage || inCode
}

export const mockGit: GitApi = {
  openRepo: async (path: string): Promise<Repo> => {
    await delay(40)
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'repository'
    return { name, root: path }
  },

  refs: async () => {
    await delay(40)
    return refs
  },

  search: async ({ keyword, code, branch, filters }: SearchArgs) => {
    await delay(220)
    const needle = keyword.trim()
    // An empty field is a full search, the way every git client behaves:
    // everything the filters allow, newest first.
    const hits = fixtures.filter(f => {
      if (branch !== null && !f.branches.includes(branch)) return false
      if (!matchesFilters(f, filters)) return false
      return matchesKeyword(f, needle, code, filters)
    })
    return hits.sort(newestFirst).map(toCommit)
  },

  cancelSearch: async () => {},

  files: async (
    shas: ReadonlyArray<string>,
    endpoints: Endpoints | null,
  ): Promise<ReadonlyArray<FilePatch>> => {
    if (endpoints !== null) {
      const from = treeAt(endpoints.from)
      const to = treeAt(endpoints.to)
      const compared: FilePatch[] = []
      for (const [path, file] of to) {
        const before = from.get(path)
        if (before !== undefined && before.patch === file.patch) continue
        compared.push({
          path,
          added: file.added,
          removed: before === undefined ? 0 : file.removed,
          isNew: before === undefined,
        })
      }
      for (const [path, file] of from) {
        if (to.has(path)) continue
        compared.push({ path, added: 0, removed: file.added, isNew: false })
      }
      return compared.sort((a, b) => a.path.localeCompare(b.path))
    }
    const byPath = new Map<string, FilePatch>()
    for (const f of fixtures) {
      if (!shas.includes(f.sha)) continue
      for (const file of f.files) {
        const seen = byPath.get(file.path)
        byPath.set(
          file.path,
          seen === undefined
            ? { path: file.path, added: file.added, removed: file.removed, isNew: file.isNew }
            : {
                path: file.path,
                added: seen.added + file.added,
                removed: seen.removed + file.removed,
                isNew: seen.isNew,
              },
        )
      }
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  },

  patch: async (
    shas: ReadonlyArray<string>,
    path: string,
    endpoints: Endpoints | null,
  ): Promise<string> => {
    if (endpoints !== null) {
      const to = treeAt(endpoints.to).get(path)
      const from = treeAt(endpoints.from).get(path)
      const body = to ?? from
      if (body === undefined) return ''
      return [
        `# ${endpoints.from} → ${endpoints.to}`,
        `diff --git a/${path} b/${path}`,
        body.patch,
      ].join('\n')
    }
    const parts: string[] = []
    for (const f of [...fixtures].filter(x => shas.includes(x.sha)).sort(newestFirst).reverse()) {
      for (const file of f.files) {
        if (file.path !== path) continue
        parts.push(`# ${f.sha} ${f.subject}`, `diff --git a/${file.path} b/${file.path}`, file.patch)
      }
    }
    return parts.join('\n')
  },

  roots: async (
    shas: ReadonlyArray<string>,
    endpoints: Endpoints | null,
  ): Promise<ReadonlyArray<RootOf>> => {
    if (endpoints !== null) {
      return [endpoints.from, endpoints.to].flatMap(value => {
        const roots = new Set(
          fixtures
            .filter(f => f.sha === value || f.branches.includes(value))
            .map(f => f.root),
        )
        return roots.size === 0
          ? [{ sha: value, root: value }]
          : [...roots].map(root => ({ sha: value, root }))
      })
    }
    return fixtures
      .filter(f => shas.includes(f.sha))
      .map(f => ({ sha: f.sha, root: f.root }))
  },
}

// The fixture keeps config in memory: the browser has no app data dir.
let mockConfig: Config = { recents: [], last: null, branches: [] }

export const mockConfigApi = {
  load: async (): Promise<Config> => mockConfig,
  save: async (config: Config): Promise<void> => {
    mockConfig = config
  },
}

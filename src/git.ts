// The seam the UI talks to. `tauriGit` is the real one; `mockGit` is what the
// browser dev server and the tests run against, with the same shapes.
import type { Commit, Endpoints, FilePatch, Ref, Repo, RootOf, SearchArgs } from './types'

export type GitApi = Readonly<{
  openRepo: (path: string) => Promise<Repo>
  refs: (repo: string) => Promise<ReadonlyArray<Ref>>
  search: (args: SearchArgs) => Promise<ReadonlyArray<Commit>>
  cancelSearch: (id: number) => Promise<void>
  // `endpoints` set means a tree diff of two tips; null means the ticked shas.
  // `needle` (with `regex`) marks the files the code search matched.
  files: (
    shas: ReadonlyArray<string>,
    endpoints: Endpoints | null,
    needle: string | null,
    regex: boolean,
  ) => Promise<ReadonlyArray<FilePatch>>
  patch: (shas: ReadonlyArray<string>, path: string, endpoints: Endpoints | null) => Promise<string>
  roots: (shas: ReadonlyArray<string>, endpoints: Endpoints | null) => Promise<ReadonlyArray<RootOf>>
}>

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

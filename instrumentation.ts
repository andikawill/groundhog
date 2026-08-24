export async function register() {
  // Next compiles this file for the edge runtime as well as for node, and webpack traces a
  // dynamic import into both graphs. Importing the service here would drag node:fs/promises
  // (via lib/service/files.ts) into the edge bundle, which fails the build for every route.
  // The store is what this needs anyway.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { markOrphansInterrupted } = await import('./lib/store/runs')
  const count = await markOrphansInterrupted()
  if (count > 0) console.log(`[groundhog] marked ${count} interrupted run(s)`)
}

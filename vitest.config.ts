import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Prisma reads DATABASE_URL from process.env. It does load .env by itself in some setups but
// not inside a vitest worker, so the suite cannot depend on that happening. An exported value
// still wins — CI sets one per job and never writes an .env file — and a checkout without an
// .env is left alone rather than crashed on.
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  test: {
    // Three suites clear the same SQLite table between tests. Vitest runs files in
    // parallel by default, which makes them delete each other's rows at random.
    fileParallelism: false,
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Three suites clear the same SQLite table between tests. Vitest runs files in
    // parallel by default, which makes them delete each other's rows at random.
    fileParallelism: false,
  },
})

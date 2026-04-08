import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Each test file runs in its own Node.js fork so Puppeteer
    // browser instances are properly isolated between files.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Silence verbose output; show only failures + summary.
    reporters: ['verbose'],
    env: {
      TEST_BASE_URL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
      PUPPETEER_EXECUTABLE_PATH:
        process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/brave-browser',
    },
  },
})

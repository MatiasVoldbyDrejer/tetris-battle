#!/usr/bin/env node
// The `tetris` command: the terminal front end, which Node runs from its
// TypeScript source.
if (!process.features.typescript) {
  console.error(`tetris: needs Node 22.18 or newer (this is ${process.version})`)
  process.exit(1)
}
await import('../cli/main.ts')

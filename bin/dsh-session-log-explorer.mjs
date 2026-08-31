#!/usr/bin/env node

import { runCli } from '../scripts/cli.mjs'

runCli().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

#!/usr/bin/env bun
import { runCli } from "./src/cli.ts";

const exitCode = await runCli({ argv: process.argv.slice(2), cwd: process.cwd() });
process.exit(exitCode);

#!/usr/bin/env node

import { doctorCommand } from "../lib/commands/doctor.js";
import { buildCommand } from "../lib/commands/build.js";
import { devCommand } from "../lib/commands/dev.js";
import { generateCommand } from "../lib/commands/generate.js";
import { verifyCommand } from "../lib/commands/verify.js";
import { inspectCommand } from "../lib/commands/inspect.js";
import { handleCliError, printHelp } from "../lib/cli.js";
import { VERSION } from "../lib/constants.js";

const argv = process.argv.slice(2);
const command = argv[0];
const jsonOutput = argv.includes("--json");

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const handlers = {
  build: buildCommand,
  dev: devCommand,
  doctor: doctorCommand,
  generate: generateCommand,
  verify: verifyCommand,
  inspect: inspectCommand,
};

if (!(command in handlers)) {
  handleCliError(new Error(`Unknown pracht command: ${command}`), { json: false });
}

handlers[command](argv.slice(1)).catch((error) => {
  handleCliError(error, { json: jsonOutput });
});

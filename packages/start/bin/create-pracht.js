#!/usr/bin/env node

import { run } from "../src/index.js";

run().catch((error) => {
  console.error("Failed to create a pracht app.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

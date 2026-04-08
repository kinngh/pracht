import { createServer } from "vite";

import { parseFlags } from "../cli.js";

export async function devCommand(args) {
  const options = parseFlags(args);
  const port = parseInt(process.env.PORT || options._[0] || "3000", 10);

  const server = await createServer({
    root: process.cwd(),
    server: { port },
  });

  await server.listen();
  server.printUrls();
}

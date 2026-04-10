import { parseFlags } from "../cli.js";
import { runVerification } from "../verification.js";

export async function verifyCommand(args) {
  const options = parseFlags(args);
  const report = runVerification(process.cwd(), { changed: Boolean(options.changed) });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Pracht verify (${report.mode} mode, ${report.scope} scope)`);
    for (const check of report.checks) {
      console.log(`${check.status.toUpperCase().padEnd(7)} ${check.message}`);
    }
    console.log(report.ok ? "\nNo blocking issues found." : "\nBlocking issues found.");
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

// `npm run dwh:*` commands (dispatched from src/cli.ts). Phase 1: offline only, no database.
import { dwhCheck, dwhConvert } from "./sources.ts";

export async function runDwh(command: string, _args: string[], root: string): Promise<number> {
  switch (command) {
    case "dwh:convert": {
      const r = dwhConvert(root);
      for (const f of r.written) console.log(`wrote   ${f}`);
      for (const f of r.removed) console.log(`removed ${f}`);
      if (r.refused.length) console.log(`Not converted (see queries/dwh/_manifest.json for the reason): ${r.refused.join(", ")}`);
      console.log(r.written.length || r.removed.length ? "queries/dwh/ updated." : "queries/dwh/ was already up to date.");
      return 0;
    }
    case "dwh:check": {
      const problems = dwhCheck(root);
      for (const p of problems) console.log(`ERROR: ${p}`);
      if (problems.length) return 1;
      console.log("queries/dwh/ is up to date.");
      return 0;
    }
    default:
      console.log(`Unknown command: ${command} (available now: dwh:convert, dwh:check)`);
      return 1;
  }
}

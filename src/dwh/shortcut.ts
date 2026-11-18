// Task 4.3: `npm run dwh:shortcut` puts a "DWH Runner" shortcut on the desktop;
// `npm run dwh:autostart` (--startup) puts one in the Startup folder, so the page starts when
// the host PC user logs in (without opening the browser). Uses PowerShell's WScript.Shell.
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function shortcutScript(o: { root: string; startup: boolean }): string {
  const target = `${o.root.replace(/[\\/]+$/, "")}\\Start DWH Runner.cmd`;
  return [
    "$ErrorActionPreference = 'Stop'",
    `$dir = [Environment]::GetFolderPath('${o.startup ? "Startup" : "Desktop"}')`,
    "$lnk = Join-Path $dir 'DWH Runner.lnk'",
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)",
    `$s.TargetPath = ${psQuote(target)}`,
    `$s.WorkingDirectory = ${psQuote(o.root)}`,
    ...(o.startup ? ["$s.Arguments = '--no-browser'"] : []),
    "$s.WindowStyle = 7",
    "$s.Description = 'Start the DWH Runner page'",
    "$s.Save()",
    "Write-Output $lnk",
  ].join("\n");
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const startup = process.argv.includes("--startup");
  const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", shortcutScript({ root, startup })], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (err += c));
  p.on("exit", (code) => {
    if (code === 0) console.log(`Made ${out.trim()}${startup ? " (the DWH Runner now starts when you log in to this PC)" : ""}.`);
    else console.log(`The shortcut could not be made: ${err.trim() || `exit code ${code}`}`);
    process.exit(code ?? 1);
  });
}

// Task 4.3: `npm run dwh:share-setup` — switch on sharing of the DWH Runner page on the WAN
// (plan A.8 #8). Asks for the access code without showing it and stores only its scrypt hash.
// Certificate: an IT PFX if given (--pfx), else a self-signed one made with PowerShell's
// New-SelfSignedCertificate, exported to dwh/local/runner.pfx and removed from the Windows store.
// Writes dwh/local/share.json (git-ignored). It never changes the firewall: the guide gives IT
// the netsh command.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createSecureContext } from "node:tls";
import { hostname, networkInterfaces } from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashCode, type ShareConfig } from "./share.ts";
import { FIRST_PORT } from "./server.ts";

export const SHARE_SETUP_USAGE =
  "Usage: npm run dwh:share-setup -- [--host NAME]... [--allow 10.0.0.0/8]... [--pfx it-certificate.pfx] [--off]";
/** Six digits are accepted (user's choice, 2026-11-18): only colleagues reach the WAN, and five wrong codes lock a PC out for 15 minutes. */
const MIN_CODE = 6;

export function buildShareConfig(o: { code: string; hostNames: string[]; allowCidrs: string[]; pfxPath: string; pfxPassphrase: string }): ShareConfig {
  const { hash, salt } = hashCode(o.code);
  return { share: true, hostNames: o.hostNames, allowCidrs: o.allowCidrs, pfxPath: o.pfxPath, pfxPassphrase: o.pfxPassphrase, codeHash: hash, codeSalt: salt };
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*$/;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The PowerShell that makes a self-signed certificate for the host names (the PFX password comes from $env:DWH_PFX_PASSPHRASE). */
export function selfSignedScript(o: { hostNames: string[]; pfxPath: string }): string {
  if (!o.hostNames.length) throw new Error("Give at least one host name (--host).");
  for (const h of o.hostNames) if (!IPV4.test(h) && !NAME.test(h)) throw new Error(`"${h}" is not a valid host name or IPv4 address.`);
  // localhost / 127.0.0.1 too: the launcher opens https://localhost on the host PC itself.
  const all = [...o.hostNames, ...["localhost", "127.0.0.1"].filter((h) => !o.hostNames.some((x) => x.toLowerCase() === h))];
  const san = all.map((h) => (IPV4.test(h) ? `IPAddress=${h}` : `DNS=${h}`)).join("&");
  const cn = o.hostNames.find((h) => !IPV4.test(h)) ?? o.hostNames[0]!;
  return [
    "$ErrorActionPreference = 'Stop'",
    `$c = New-SelfSignedCertificate -Subject ${psQuote(`CN=${cn}`)} -TextExtension @(${psQuote(`2.5.29.17={text}${san}`)}) -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName 'DWH Runner' -NotAfter (Get-Date).AddYears(3) -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable`,
    "$pw = ConvertTo-SecureString -String $env:DWH_PFX_PASSPHRASE -Force -AsPlainText",
    `Export-PfxCertificate -Cert $c -FilePath ${psQuote(o.pfxPath)} -Password $pw | Out-Null`,
    'Remove-Item -Path ("Cert:\\CurrentUser\\My\\" + $c.Thumbprint)',
  ].join("\n");
}

type Nics = Record<string, { family: string | number; internal: boolean; address: string }[] | undefined>;

/** This PC's name (and full DNS name if given) and IPv4 addresses, without link-local 169.254.x.x (no network). */
export function defaultHostNames(nics: Nics = networkInterfaces() as Nics, host: string = hostname(), fqdn?: string): string[] {
  const names = [host, ...(fqdn && fqdn.toLowerCase() !== host.toLowerCase() ? [fqdn] : [])];
  for (const list of Object.values(nics)) for (const a of list ?? []) if ((a.family === "IPv4" || a.family === 4) && !a.internal && !a.address.startsWith("169.254.")) names.push(a.address);
  return [...new Set(names)];
}

/** Reads answers line by line from a pipe (no terminal), e.g. when the code is piped in. */
export function linePrompter(input: NodeJS.ReadableStream, write: (s: string) => void): (question: string) => Promise<string> {
  const lines: string[] = [];
  const waiting: ((l: string) => void)[] = [];
  let buf = "";
  let ended = false;
  const push = (l: string) => {
    const w = waiting.shift();
    if (w) w(l);
    else lines.push(l);
  };
  input.on("data", (c: Buffer | string) => {
    buf += c.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      push(buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
    }
  });
  input.on("end", () => {
    ended = true;
    if (buf) push(buf.replace(/\r$/, ""));
    buf = "";
    while (waiting.length) waiting.shift()!("");
  });
  return (question) => {
    write(question);
    write("\n");
    if (lines.length) return Promise.resolve(lines.shift()!);
    if (ended) return Promise.resolve("");
    return new Promise((r) => waiting.push(r));
  };
}

export interface SetupIo {
  log(s: string): void;
  /** Asks without showing what is typed. */
  askHidden(question: string): Promise<string>;
}

export interface SetupDeps {
  /** Runs the certificate script (default: PowerShell). */
  makeCert?: (script: string, pfxPath: string, passphrase: string) => Promise<void>;
  /** Does the PFX open with this password? */
  checkPfx?: (pfxPath: string, passphrase: string) => boolean;
}

function runPowerShell(script: string, _pfxPath: string, passphrase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DWH_PFX_PASSPHRASE: passphrase }, stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`PowerShell could not make the certificate: ${err.trim() || `exit code ${code}`}`))));
  });
}

function pfxOpens(pfxPath: string, passphrase: string): boolean {
  try {
    createSecureContext({ pfx: readFileSync(pfxPath), passphrase });
    return true;
  } catch {
    return false;
  }
}

/** Asks on the terminal without echo (raw mode). */
export function askHiddenTty(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal window (it asks for the access code)."));
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (s: string) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          return reject(new Error("Cancelled."));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export async function shareSetupCli(root: string, args: string[], io: SetupIo, deps: SetupDeps = {}): Promise<number> {
  const makeCert = deps.makeCert ?? runPowerShell;
  const checkPfx = deps.checkPfx ?? pfxOpens;
  const dir = path.join(root, "dwh", "local");
  const file = path.join(dir, "share.json");
  try {
    const hosts: string[] = [];
    const allow: string[] = [];
    let itPfx: string | undefined;
    let off = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const value = () => {
        const v = args[++i];
        if (v === undefined) throw new Error(`${a} needs a value. ${SHARE_SETUP_USAGE}`);
        return v;
      };
      if (a === "--host") hosts.push(value().trim());
      else if (a === "--allow") allow.push(value().trim());
      else if (a === "--pfx") itPfx = path.resolve(value());
      else if (a === "--off") off = true;
      else throw new Error(`Unknown option ${a}. ${SHARE_SETUP_USAGE}`);
    }
    if (off) {
      const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify({ ...cur, share: false }, null, 2)}\n`);
      io.log("Sharing is off. Restart the DWH Runner; it is now only reachable on this PC.");
      return 0;
    }
    const hostNames = hosts.length ? hosts : defaultHostNames();
    for (const h of hostNames) if (!IPV4.test(h) && !NAME.test(h)) throw new Error(`"${h}" is not a valid host name or IPv4 address.`);
    io.log(`Colleagues will be able to use these addresses: ${hostNames.map((h) => `https://${h}:${FIRST_PORT}`).join(", ")}`);

    const code = await io.askHidden(`Choose the access code (at least ${MIN_CODE} characters, not shown): `);
    if (code.length < MIN_CODE) throw new Error(`The access code must have at least ${MIN_CODE} characters. Nothing was changed.`);
    const again = await io.askHidden("Type it again: ");
    if (again !== code) throw new Error("The two codes did not match. Nothing was changed.");

    let pfxPath: string;
    let pfxPassphrase: string;
    if (itPfx) {
      if (!existsSync(itPfx)) throw new Error(`The certificate file ${itPfx} does not exist.`);
      pfxPassphrase = await io.askHidden("Password of the IT certificate file (not shown): ");
      if (!checkPfx(itPfx, pfxPassphrase)) throw new Error("The certificate file could not be opened with that password. Nothing was changed.");
      pfxPath = itPfx;
    } else {
      mkdirSync(dir, { recursive: true });
      pfxPath = path.join(dir, "runner.pfx");
      pfxPassphrase = randomBytes(24).toString("hex");
      io.log("Making a self-signed certificate (colleagues' browsers will show a one-time warning; an IT certificate avoids it)…");
      await makeCert(selfSignedScript({ hostNames, pfxPath }), pfxPath, pfxPassphrase);
      if (!checkPfx(pfxPath, pfxPassphrase)) throw new Error("The new certificate could not be opened. Nothing was changed.");
    }

    mkdirSync(dir, { recursive: true });
    const cfg = buildShareConfig({ code, hostNames, allowCidrs: allow, pfxPath, pfxPassphrase });
    writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
    io.log(`Wrote ${path.relative(root, file)} (it holds a hash of the code, never the code itself).`);
    io.log("Next:");
    io.log("  1. Close the DWH Runner window and start it again (desktop shortcut or Start DWH Runner.cmd).");
    io.log(`  2. Ask IT to allow the port in Windows Firewall on this PC, for the company network only:`);
    io.log(`     netsh advfirewall firewall add rule name="DWH Runner" dir=in action=allow protocol=TCP localport=${FIRST_PORT} profile=domain`);
    io.log(`  3. Colleagues open https://${hostNames[0]}:${FIRST_PORT} and enter the access code.`);
    io.log("  To stop sharing: npm run dwh:share-setup -- --off");
    return 0;
  } catch (e) {
    io.log(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const askHidden = process.stdin.isTTY ? askHiddenTty : linePrompter(process.stdin, (s) => process.stdout.write(s));
  shareSetupCli(root, process.argv.slice(2), { log: (s) => console.log(s), askHidden }).then((code) => process.exit(code));

}

// Task 4.1: sharing settings for the runner page (plan A.8 #8). dwh/local/share.json is written by
// `npm run dwh:share-setup` and is git-ignored. It holds only a scrypt hash of the access code.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export interface ShareConfig {
  share: boolean;
  /** Names colleagues type in the address bar (PC name, DNS name, IP). */
  hostNames: string[];
  /** Optional: only these networks may connect (IPv4 CIDRs such as 10.20.0.0/16). */
  allowCidrs: string[];
  pfxPath?: string;
  /** Password of the PFX file (an IT certificate's, or the random one dwh:share-setup made). */
  pfxPassphrase?: string;
  codeHash?: string;
  codeSalt?: string;
}

/** Sharing was asked for, but something it needs is missing. */
export class ShareNotReady extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Sharing is switched on in dwh/local/share.json, but it needs ${missing.join(" and ")}. Run npm run dwh:share-setup, or set "share": false.`);
    this.name = "ShareNotReady";
    this.missing = missing;
  }
}

const UNSHARED: ShareConfig = { share: false, hostNames: [], allowCidrs: [] };

/** Reads dwh/local/share.json; a missing file means unshared. */
export function loadShareConfig(file: string): ShareConfig {
  if (!existsSync(file)) return { ...UNSHARED };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ShareConfig>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    share: raw.share === true,
    hostNames: list(raw.hostNames),
    allowCidrs: list(raw.allowCidrs),
    ...(typeof raw.pfxPath === "string" ? { pfxPath: raw.pfxPath } : {}),
    ...(typeof raw.pfxPassphrase === "string" ? { pfxPassphrase: raw.pfxPassphrase } : {}),
    ...(typeof raw.codeHash === "string" ? { codeHash: raw.codeHash } : {}),
    ...(typeof raw.codeSalt === "string" ? { codeSalt: raw.codeSalt } : {}),
  };
}

/** What a shared server still lacks (empty = ready). */
export function shareProblems(c: ShareConfig): string[] {
  const missing: string[] = [];
  if (!c.pfxPath || !existsSync(c.pfxPath)) missing.push("a certificate (the PFX file in pfxPath)");
  if (!c.codeHash || !c.codeSalt) missing.push("an access code");
  if (!c.hostNames.length) missing.push("at least one host name colleagues use");
  for (const cidr of c.allowCidrs) if (!parseCidr(cidr)) missing.push(`a valid network in allowCidrs (not "${cidr}")`);
  return missing;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

/** scrypt hash and salt (hex) of an access code; the code itself is never stored. */
export function hashCode(code: string, salt: Buffer = randomBytes(16)): { hash: string; salt: string } {
  const hash = scryptSync(code, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

export function verifyCode(code: string, c: Pick<ShareConfig, "codeHash" | "codeSalt">): boolean {
  if (!c.codeHash || !c.codeSalt || typeof code !== "string" || code.length > 200) return false;
  const want = Buffer.from(c.codeHash, "hex");
  const got = Buffer.from(hashCode(code, Buffer.from(c.codeSalt, "hex")).hash, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** "::ffff:10.1.2.3" -> "10.1.2.3". */
export function plainIp(addr: string | undefined): string {
  const a = addr ?? "";
  return a.startsWith("::ffff:") ? a.slice(7) : a;
}

/** The host PC itself (plan A.8: Quit and Refresh catalogue only from 127.0.0.1). */
export function isHostAddress(addr: string | undefined): boolean {
  const a = plainIp(addr);
  return a === "127.0.0.1" || a === "::1";
}

function ipv4ToInt(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function parseCidr(cidr: string): { base: number; mask: number } | undefined {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(cidr.trim());
  const base = m ? ipv4ToInt(m[1]!) : ipv4ToInt(cidr.trim());
  const bits = m ? Number(m[2]) : 32;
  if (base === undefined || bits > 32) return undefined;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

/** Is the visitor allowed by allowCidrs? Empty list = everyone; the host PC always is. */
export function addressAllowed(addr: string | undefined, cidrs: string[]): boolean {
  if (!cidrs.length || isHostAddress(addr)) return true;
  const ip = ipv4ToInt(plainIp(addr));
  if (ip === undefined) return false;
  return cidrs.some((c) => {
    const p = parseCidr(c);
    return p !== undefined && ((ip & p.mask) >>> 0) === p.base;
  });
}

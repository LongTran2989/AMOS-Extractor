// Task 4.3: `npm run dwh:share-setup` (no PowerShell is run in these tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { buildShareConfig, defaultHostNames, linePrompter, selfSignedScript, shareSetupCli, type SetupIo } from "../../src/dwh/shareSetup.ts";
import { shortcutScript } from "../../src/dwh/shortcut.ts";
import { loadShareConfig, verifyCode } from "../../src/dwh/share.ts";
import { ROOT } from "./helpers.ts";

const PFX = path.join(ROOT, "test", "dwh", "fixtures", "server-test.pfx");
const CODE = "open-sesame-42";

test("hash verifies", () => {
  const c = buildShareConfig({ code: CODE, hostNames: ["dwh-host"], allowCidrs: [], pfxPath: "x.pfx", pfxPassphrase: "p" });
  assert.equal(c.share, true);
  assert.equal(verifyCode(CODE, c), true);
  assert.equal(verifyCode("open-sesame-43", c), false);
  assert.equal(verifyCode("", c), false);
  assert.match(c.codeHash!, /^[0-9a-f]{64}$/);
  assert.match(c.codeSalt!, /^[0-9a-f]{32}$/);
});

/** Answers the prompts in order; records everything printed. */
function fakeIo(answers: string[]): SetupIo & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    log: (s) => out.push(s),
    askHidden: async (q) => {
      out.push(q);
      return answers.shift() ?? "";
    },
  };
}

test("no plain code written (self-signed certificate made by the injected maker)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "share-"));
  try {
    let script = "";
    const io = fakeIo([CODE, CODE]);
    const code = await shareSetupCli(root, ["--host", "dwh-host", "--host", "10.1.2.3"], io, {
      makeCert: async (s, pfxPath) => {
        script = s;
        copyFileSync(PFX, pfxPath);
      },
      checkPfx: () => true,
    });
    assert.equal(code, 0, io.out.join("\n"));
    const dir = path.join(root, "dwh", "local");
    for (const f of readdirSync(dir)) assert.ok(!readFileSync(path.join(dir, f)).includes(CODE), `${f} contains the code`);
    assert.ok(!io.out.join("\n").includes(CODE), "the code is never printed");
    const cfg = loadShareConfig(path.join(dir, "share.json"));
    assert.equal(cfg.share, true);
    assert.deepEqual(cfg.hostNames, ["dwh-host", "10.1.2.3"]);
    assert.equal(cfg.pfxPath, path.join(dir, "runner.pfx"));
    assert.equal(verifyCode(CODE, cfg), true);
    assert.ok(cfg.pfxPassphrase && !script.includes(cfg.pfxPassphrase), "the PFX password is passed outside the script text");
    assert.match(io.out.join("\n"), /netsh advfirewall firewall add rule name="DWH Runner" dir=in action=allow protocol=TCP localport=4870 profile=domain/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an IT certificate is used as given; its password is checked", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "share-"));
  try {
    const bad = fakeIo([CODE, CODE, "wrong-password"]);
    assert.equal(await shareSetupCli(root, ["--host", "dwh-host", "--pfx", PFX], bad), 1);
    assert.match(bad.out.join("\n"), /could not be opened with that password/);
    assert.equal(existsSync(path.join(root, "dwh", "local", "share.json")), false);
    const ok = fakeIo([CODE, CODE, "test-only"]);
    assert.equal(await shareSetupCli(root, ["--host", "dwh-host", "--pfx", PFX, "--allow", "10.0.0.0/8"], ok), 0, ok.out.join("\n"));
    const cfg = loadShareConfig(path.join(root, "dwh", "local", "share.json"));
    assert.equal(cfg.pfxPath, path.resolve(PFX));
    assert.deepEqual(cfg.allowCidrs, ["10.0.0.0/8"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a short or mistyped code writes nothing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "share-"));
  try {
    const short = fakeIo(["short", "short"]);
    assert.equal(await shareSetupCli(root, ["--host", "dwh-host"], short, { makeCert: async () => assert.fail("no certificate"), checkPfx: () => true }), 1);
    assert.match(short.out.join("\n"), /at least 6 characters/);
    const typo = fakeIo([CODE, `${CODE}x`]);
    assert.equal(await shareSetupCli(root, ["--host", "dwh-host"], typo, { makeCert: async () => assert.fail("no certificate"), checkPfx: () => true }), 1);
    assert.match(typo.out.join("\n"), /did not match/);
    assert.equal(existsSync(path.join(root, "dwh", "local", "share.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PowerShell command line built correctly without running it", () => {
  const s = selfSignedScript({ hostNames: ["dwh-host", "dwh-host.corp.example", "10.1.2.3"], pfxPath: "C:\\Users\\o'neil\\dwh\\local\\runner.pfx" });
  assert.match(s, /New-SelfSignedCertificate /);
  assert.match(s, /-CertStoreLocation 'Cert:\\CurrentUser\\My'/);
  assert.match(s, /2\.5\.29\.17=\{text\}DNS=dwh-host&DNS=dwh-host\.corp\.example&IPAddress=10\.1\.2\.3&DNS=localhost&IPAddress=127\.0\.0\.1'/, "the host PC's own localhost page needs no warning either");
  assert.match(s, /-Subject 'CN=dwh-host'/);
  assert.match(s, /ConvertTo-SecureString -String \$env:DWH_PFX_PASSPHRASE -Force -AsPlainText/);
  assert.match(s, /Export-PfxCertificate -Cert \$c -FilePath 'C:\\Users\\o''neil\\dwh\\local\\runner\.pfx' -Password \$pw/);
  assert.match(s, /Remove-Item -Path \("Cert:\\CurrentUser\\My\\" \+ \$c\.Thumbprint\)/, "the certificate is not left in the Windows store");
  assert.throws(() => selfSignedScript({ hostNames: ["dwh'host"], pfxPath: "x.pfx" }), /host name/);
  assert.throws(() => selfSignedScript({ hostNames: [], pfxPath: "x.pfx" }), /host name/);
});

test("shortcut script: desktop or Startup folder, minimised launcher, quoted paths", () => {
  const d = shortcutScript({ root: "H:\\AMOS-Extractor", startup: false });
  assert.match(d, /GetFolderPath\('Desktop'\)/);
  assert.match(d, /\$s\.TargetPath = 'H:\\AMOS-Extractor\\Start DWH Runner\.cmd'/);
  assert.match(d, /\$s\.WorkingDirectory = 'H:\\AMOS-Extractor'/);
  assert.match(d, /\$s\.WindowStyle = 7/);
  assert.doesNotMatch(d, /--no-browser/);
  const st = shortcutScript({ root: "C:\\it's here", startup: true });
  assert.match(st, /GetFolderPath\('Startup'\)/);
  assert.match(st, /\$s\.Arguments = '--no-browser'/);
  assert.match(st, /'C:\\it''s here\\Start DWH Runner\.cmd'/);
});

test("a six-digit code is accepted", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "share-"));
  try {
    const io = fakeIo(["123456", "123456"]);
    const code = await shareSetupCli(root, ["--host", "dwh-host"], io, { makeCert: async (_s, pfxPath) => copyFileSync(PFX, pfxPath), checkPfx: () => true });
    assert.equal(code, 0, io.out.join("\n"));
    assert.equal(verifyCode("123456", loadShareConfig(path.join(root, "dwh", "local", "share.json"))), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("suggested addresses leave out link-local 169.254.x.x", () => {
  const nics = { eth: [{ family: "IPv4", internal: false, address: "169.254.83.107" }, { family: "IPv4", internal: false, address: "10.4.104.70" }], lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] };
  assert.deepEqual(defaultHostNames(nics, "PC1", "PC1.corp.example"), ["PC1", "PC1.corp.example", "10.4.104.70"]);
});

test("the code can be piped in when there is no terminal", async () => {
  const { Readable } = await import("node:stream");
  const ask = linePrompter(Readable.from(["112", "989\r\n", "112989\n"]), () => {});
  assert.equal(await ask("code: "), "112989");
  assert.equal(await ask("again: "), "112989");
});

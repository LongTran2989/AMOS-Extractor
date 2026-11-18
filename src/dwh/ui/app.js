// DWH Runner page (plan A.9). Plain browser JavaScript, no libraries. The page only ever sends a
// query path and placeholder values (never SQL); the server re-reads and re-converts the query
// on every select and every run. Untrusted text is always set with textContent.
"use strict";

const TOKEN = document.querySelector('meta[name="runner-token"]').content;
const $ = (id) => document.getElementById(id);
const ICON = { ready: "✓", notes: "⚠", unavailable: "⊘", refused: "✗" };
const STATE_TEXT = { ready: "ready", notes: "ready, with notes", unavailable: "not available in the DWH", refused: "cannot convert" };

let current = null; // the /api/convert answer for the selected query
let pack = null; // the /api/verify-pack answer (Compare step 1)
let running = false;
let quitArmed = false;

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

/** A plain error from the server (message + optional technical details). */
class PlainError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

async function api(path, body) {
  const opts = { method: body === undefined ? "GET" : "POST", headers: { "X-Runner-Token": TOKEN } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new PlainError("The DWH Runner on the host PC does not answer. Is it still running?");
  }
  return readAnswer(res);
}

async function readAnswer(res) {
  let j = null;
  try {
    j = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok) throw new PlainError((j && j.error) || `The DWH Runner answered with an error (${res.status}).`, j && j.detail);
  return j;
}

function showError(e) {
  const box = $("error");
  box.replaceChildren(el("div", { text: e.message || String(e) }));
  if (e.detail) box.append(el("details", {}, el("summary", { text: "Details for whoever maintains this tool" }), el("pre", { text: e.detail })));
  box.hidden = false;
}
const clearError = () => {
  $("error").hidden = true;
  $("error").replaceChildren();
};

function fmtUtc(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
function age(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 0)) return "";
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} old`;
  const hours = Math.floor(ms / 3600000);
  return hours >= 1 ? `${hours} h old` : "less than an hour old";
}

// ---- header -------------------------------------------------------------------------------

async function loadStatus() {
  try {
    const s = await api("/api/status");
    $("fake").hidden = s.engine !== "fake";
    if (s.freshness) $("freshness").textContent = `DWH data as of ${fmtUtc(s.freshness)}`;
    else {
      $("freshness").textContent = "DWH: freshness unknown";
      if (s.freshnessError) $("freshness").title = s.freshnessError;
    }
    $("refresh").hidden = $("quit").hidden = !s.host;
  } catch (e) {
    $("freshness").textContent = "DWH: freshness unknown";
    $("freshness").title = e.message;
  }
}

function hostMessage(text) {
  $("hostmsg").textContent = text;
  $("hostmsg").hidden = false;
}

$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  hostMessage("Reading the DWH catalogue…");
  try {
    const r = await api("/api/catalogue/refresh", {});
    hostMessage(r.message);
    await loadSources();
    if (current) await select(current.path);
  } catch (e) {
    hostMessage(e.message);
  } finally {
    $("refresh").disabled = false;
  }
});

$("quit").addEventListener("click", async () => {
  if (!quitArmed) {
    quitArmed = true;
    $("quit").textContent = "Click again to stop";
    setTimeout(() => {
      quitArmed = false;
      $("quit").textContent = "Quit";
    }, 4000);
    return;
  }
  try {
    const r = await api("/api/quit", {});
    document.body.replaceChildren(el("p", { class: "pad", text: r.message }));
  } catch (e) {
    hostMessage(e.message);
  }
});

// ---- query list ---------------------------------------------------------------------------

function sourceButton(s) {
  const label = s.path.replace(/^queries\/wp_seqs\//, "");
  const b = el("button", { type: "button", "data-path": s.path, title: `${STATE_TEXT[s.state]}${s.reason ? `: ${s.reason}` : ""}` }, el("span", { class: `st ${s.state}`, text: ICON[s.state] }), el("span", { text: label.replace(/\.sql$/, "") }));
  b.addEventListener("click", () => select(s.path));
  return el("li", {}, b);
}

async function loadSources() {
  try {
    const r = await api("/api/sources");
    const list = $("sources");
    list.replaceChildren();
    const root = r.sources.filter((s) => !s.path.includes("/"));
    const seqs = r.sources.filter((s) => s.path.startsWith("queries/wp_seqs/"));
    for (const s of root) list.append(sourceButton(s));
    if (seqs.length) {
      const worst = ["refused", "unavailable", "notes", "ready"].find((st) => seqs.some((s) => s.state === st));
      const det = el("details", {}, el("summary", {}, `WP sequences (${seqs.length}) `, el("span", { class: `st ${worst}`, text: ICON[worst] })), el("ul", {}, ...seqs.map(sourceButton)));
      if (current && current.path.startsWith("queries/wp_seqs/")) det.open = true;
      list.append(el("li", {}, det));
    }
    markCurrent();
  } catch (e) {
    $("sources").replaceChildren(el("li", { class: "muted", text: e.message }));
  }
}

function markCurrent() {
  for (const b of document.querySelectorAll(".sources button")) b.setAttribute("aria-current", String(!!current && b.dataset.path === current.path));
}

// ---- one query ----------------------------------------------------------------------------

function setTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) {
    const on = b.dataset.tab === name && b.getAttribute("aria-selected") !== "true";
    b.setAttribute("aria-selected", String(on));
    $(`tab-${b.dataset.tab}`).hidden = !on;
  }
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => setTab(b.dataset.tab));

function renderStatus(c) {
  const box = $("status");
  box.replaceChildren();
  const line = (cls, text) => box.append(el("div", { class: cls, text }));
  if (c.state === "refused") {
    const r = c.refused || {};
    line("bad", `✗ This query cannot be run in the DWH: ${r.message || "it could not be converted"}${r.line ? ` (line ${r.line})` : ""}`);
    return;
  }
  if (c.state === "unavailable") line("bad", `⊘ Needs what the DWH doesn't have yet: ${c.missing.join(", ")}`);
  else if (c.catalogueTakenAt) {
    const errors = (c.schemaIssues || []).filter((i) => i.severity === "error");
    if (!errors.length) line("ok", `✓ All ${c.columnsChecked} columns found in the DWH (catalogue ${age(c.catalogueTakenAt)})`);
  } else line("warn", "⚠ No DWH catalogue yet: columns are not checked (the host can press Refresh catalogue).");
  const notes = [...(c.warnings || []).map((w) => w.plain), ...(c.schemaIssues || []).filter((i) => i.severity !== "info").map((i) => i.plain)];
  if (notes.length) {
    box.append(el("div", { class: "warn", text: "⚠ Notes:" }));
    box.append(el("ul", {}, ...[...new Set(notes)].map((n) => el("li", { text: n }))));
  }
}

function renderParams(c) {
  const form = $("params");
  const old = {};
  for (const i of form.querySelectorAll("input")) old[i.name] = i.value;
  form.replaceChildren();
  for (const p of c.placeholders || []) {
    const input = el("input", { type: "text", name: p.name, size: "28", maxlength: String(p.maxLength || 100), spellcheck: "false" });
    input.value = old[p.name] || "";
    form.append(el("label", {}, `<${p.name}>`, input, el("span", { class: "echo", "data-echo": p.name })));
  }
}
$("params").addEventListener("submit", (ev) => ev.preventDefault());

function paramValues() {
  const out = {};
  for (const i of $("params").querySelectorAll("input")) out[i.name] = i.value;
  return out;
}
function echoParams(used) {
  for (const s of $("params").querySelectorAll("[data-echo]")) {
    const v = used ? used[s.dataset.echo] : undefined;
    s.textContent = v === undefined ? "" : `used: "${v}"`;
  }
}

async function select(path) {
  clearError();
  try {
    const c = await api("/api/convert", { path });
    const samePath = current && current.path === path;
    current = c;
    if (!samePath) {
      pack = null;
      $("cmp-pack-out").hidden = true;
      $("cmp-result").hidden = true;
      $("result").replaceChildren();
      $("info").textContent = "";
    }
    $("empty").hidden = true;
    $("query").hidden = false;
    $("qname").textContent = path;
    $("pg").textContent = c.pg || "";
    $("oracle").textContent = c.oracle || "(not converted)";
    renderStatus(c);
    renderParams(c);
    const runnable = c.state === "ready" || c.state === "notes";
    $("run").disabled = $("export").disabled = $("cmp-pack").disabled = $("cmp-run").disabled = !runnable || running;
    if (c.freshness) $("freshness").textContent = `DWH data as of ${fmtUtc(c.freshness)}`;
    markCurrent();
  } catch (e) {
    showError(e);
  }
}

async function copyText(text, msgId) {
  try {
    await navigator.clipboard.writeText(text);
    $(msgId).textContent = "Copied. Paste it into AMOS.";
  } catch {
    $(msgId).textContent = "Copy did not work here: select the text and press Ctrl+C.";
  }
  setTimeout(() => ($(msgId).textContent = ""), 5000);
}
$("copy-pg").addEventListener("click", () => current && copyText(current.pg, "copy-pg-msg"));

// ---- run, download, stop ------------------------------------------------------------------

function setRunning(on, what) {
  running = on;
  const runnable = current && (current.state === "ready" || current.state === "notes");
  $("run").disabled = $("export").disabled = $("cmp-pack").disabled = $("cmp-run").disabled = on || !runnable;
  $("stop").disabled = !on;
  $("busy").textContent = on ? what : "";
}

function renderTable(columns, rows) {
  const t = $("result");
  t.replaceChildren();
  t.append(el("thead", {}, el("tr", {}, ...columns.map((c) => el("th", { text: c.name })))));
  const tb = el("tbody");
  if (!rows.length) tb.append(el("tr", {}, el("td", { class: "empty", colspan: String(Math.max(columns.length, 1)), text: "0 rows" })));
  for (const r of rows) tb.append(el("tr", {}, ...r.map((v) => el("td", { text: v, title: v.length > 40 ? v : "" }))));
  t.append(tb);
}

$("run").addEventListener("click", async () => {
  if (!current) return;
  clearError();
  await select(current.path); // re-read the source first (it may have been edited)
  if (!current || !(current.state === "ready" || current.state === "notes")) return;
  setRunning(true, "Running…");
  $("info").textContent = "";
  const asked = current.path;
  try {
    const r = await api("/api/run", { path: asked, params: paramValues() });
    if (!current || current.path !== asked) return; // another query was selected meanwhile: never show A's rows under B's name
    echoParams(r.params);
    renderTable(r.columns, r.rows);
    const n = r.rows.length;
    $("info").textContent = n === 0 ? `0 rows · ${(r.ms / 1000).toFixed(1)} s` : `${r.truncated ? `First ${n} rows (more available)` : `${n} row${n === 1 ? "" : "s"}`} · ${(r.ms / 1000).toFixed(1)} s`;
  } catch (e) {
    showError(e);
  } finally {
    setRunning(false);
  }
});

$("stop").addEventListener("click", async () => {
  try {
    await api("/api/stop", {});
    $("busy").textContent = "Stopping…";
  } catch (e) {
    showError(e);
  }
});

function fileNameOf(res) {
  const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  return m ? m[1] : "dwh-result.csv";
}

/** The name the server will give the file: <query>_DWH_<yyyymmdd-hhmm>.csv (UTC). */
function suggestedName(path) {
  const d = new Date().toISOString();
  return `${path.replace(/^.*\//, "").replace(/\.sql$/, "")}_DWH_${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}.csv`;
}

$("export").addEventListener("click", async () => {
  if (!current) return;
  clearError();
  // "Save as" first, straight from the click: the browser allows it only shortly after a click,
  // and the DWH may take a while to start answering.
  let saveHandle = null;
  if (window.showSaveFilePicker) {
    try {
      saveHandle = await window.showSaveFilePicker({ suggestedName: suggestedName(current.path), types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] });
    } catch (e) {
      if (e && e.name === "AbortError") {
        $("info").textContent = "Download cancelled.";
        return;
      }
      saveHandle = null; // not allowed here: fall back to an ordinary download
    }
  }
  await select(current.path);
  if (!current || !(current.state === "ready" || current.state === "notes")) return;
  setRunning(true, "Downloading… (Stop ends it; the file then says it is incomplete)");
  $("info").textContent = "";
  let rows = 0;
  let file = null;
  try {
    const res = await fetch("/api/export", { method: "POST", headers: { "X-Runner-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ path: current.path, params: paramValues() }) });
    if (!res.ok) await readAnswer(res);
    const name = saveHandle ? saveHandle.name : fileNameOf(res);
    const reader = res.body.getReader();
    if (saveHandle) {
      try {
        file = await saveHandle.createWritable();
      } catch {
        await reader.cancel().catch(() => {});
        throw new PlainError(`The file ${name} could not be written (is it open in Excel?). Nothing was downloaded.`);
      }
    }
    const parts = [];
    let tail = "";
    const dec = new TextDecoder();
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        // The connection was cut: the server ends a failed download that way.
        const incomplete = /"INCOMPLETE:[^\r\n]*"\r?\n?$/.test(tail);
        const msg = incomplete ? tail.trim().split("\r\n").pop().replace(/^"|"$/g, "") : `INCOMPLETE: the download stopped after about ${Math.max(rows - 1, 0)} rows (the connection was lost).`;
        const saved = file !== null;
        if (file) {
          if (!incomplete) await file.write(`"${msg}"\r\n`);
          await file.close();
          file = null;
        }
        throw new PlainError(`${msg.replace(/^INCOMPLETE: /, "The download is incomplete: ")} ${saved ? "The saved file ends with a line that says so." : "Nothing was saved."}`);
      }
      if (chunk.done) break;
      if (file) await file.write(chunk.value);
      else parts.push(chunk.value);
      const text = dec.decode(chunk.value, { stream: true });
      tail = (tail + text).slice(-2000);
      rows += (text.match(/\r\n/g) || []).length;
    }
    if (file) await file.close();
    else {
      const a = el("a", { href: URL.createObjectURL(new Blob(parts, { type: "text/csv" })), download: name });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    }
    const lastLine = tail.trimEnd().split("\r\n").pop() || "";
    $("info").textContent = lastLine.startsWith('"INCOMPLETE:') ? `Saved ${name}, but it is incomplete: ${lastLine.replace(/^"INCOMPLETE: |"$/g, "")}` : `Saved ${name}.`;
  } catch (e) {
    showError(e);
  } finally {
    if (file) await file.close().catch(() => {});
    setRunning(false);
  }
});

// ---- compare ------------------------------------------------------------------------------

$("cmp-pack").addEventListener("click", async () => {
  if (!current) return;
  clearError();
  try {
    const r = await api("/api/verify-pack", { path: current.path, at: $("cmp-at").value, params: paramValues() });
    pack = r.pack;
    $("cmp-at").value = r.at;
    $("cmp-sql").textContent = r.amosSql;
    $("cmp-pack-out").hidden = false;
    $("cmp-pack-msg").textContent = `"Now" frozen at ${r.at}.`;
  } catch (e) {
    showError(e);
  }
});
$("copy-cmp").addEventListener("click", () => copyText($("cmp-sql").textContent, "cmp-pack-msg"));

$("cmp-run").addEventListener("click", async () => {
  if (!current) return;
  clearError();
  const amos = $("cmp-file").files[0];
  if (!pack || pack.source !== current.path) return showError(new PlainError('Make the AMOS version first (step 1): it freezes "now" so both sides answer the same question.'));
  if (!amos) return showError(new PlainError("Choose the AMOS export file (step 3)."));
  const within = $("cmp-within").files[0];
  const rowsShown = $("cmp-rows").value.replace(/['’,\s]/g, "");
  if (rowsShown && !/^\d+$/.test(rowsShown)) return showError(new PlainError("Rows AMOS showed must be a whole number."));
  const meta = {
    path: current.path,
    pack,
    amosName: amos.name,
    amosBytes: amos.size,
    ...(within ? { withinName: within.name, withinBytes: within.size } : {}),
    ...(rowsShown ? { amosRows: Number(rowsShown) } : {}),
    ...($("cmp-keys").value.trim() ? { keys: $("cmp-keys").value.split(",").map((k) => k.trim()).filter(Boolean) } : {}),
  };
  setRunning(true, "Reading the DWH and comparing…");
  try {
    const body = within ? new Blob([amos, within]) : amos;
    let res;
    try {
      res = await fetch("/api/compare", { method: "POST", headers: { "X-Runner-Token": TOKEN, "Content-Type": "application/octet-stream", "X-Compare": encodeURIComponent(JSON.stringify(meta)) }, body });
    } catch {
      throw new PlainError("The DWH Runner on the host PC does not answer. Is it still running?");
    }
    const r = await readAnswer(res);
    if (!current || current.path !== meta.path) return; // another query was selected meanwhile
    $("cmp-result").hidden = false;

    $("cmp-verdict").textContent = r.pass ? "PASS: AMOS and the DWH agree" : "FAIL: see the report below";
    $("cmp-verdict").className = `verdict ${r.pass ? "pass" : "fail"}`;
    renderMarkdown($("cmp-report"), r.report);
    $("cmp-download").onclick = () => {
      const a = el("a", { href: URL.createObjectURL(new Blob([r.report], { type: "text/markdown" })), download: `${current.path.replace(/^.*\//, "").replace(/\.sql$/, "")}_compare_report.md` });
      document.body.append(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
    };
  } catch (e) {
    showError(e);
  } finally {
    setRunning(false);
  }
});

/** A small, safe Markdown subset for the compare report (headings, bold, lists, tables). */
function renderMarkdown(target, md) {
  target.replaceChildren();
  const inline = (text) => {
    const span = el("span");
    text.split(/(\*\*[^*]+\*\*)/).forEach((part) => span.append(part.startsWith("**") && part.endsWith("**") ? el("b", { text: part.slice(2, -2) }) : part.replace(/\\\|/g, "|")));
    return span;
  };
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.startsWith("## ")) target.append(el("h4", { text: l.slice(3) }));
    else if (l.startsWith("# ")) target.append(el("h3", { text: l.slice(2) }));
    else if (l.startsWith("- ")) {
      const ul = el("ul");
      while (i < lines.length && lines[i].startsWith("- ")) ul.append(el("li", {}, inline(lines[i++].slice(2))));
      i--;
      target.append(ul);
    } else if (l.startsWith("|")) {
      const table = el("table");
      const cells = (row) => row.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
      let first = true;
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = lines[i++];
        if (/^\|[-| ]+\|$/.test(row)) continue;
        table.append(el("tr", {}, ...cells(row).map((c) => el(first ? "th" : "td", {}, inline(c)))));
        first = false;
      }
      i--;
      target.append(el("div", { class: "tablewrap" }, table));
    } else target.append(el("p", {}, inline(l.replace(/ {2}$/, ""))));
  }
}

loadStatus();
loadSources();

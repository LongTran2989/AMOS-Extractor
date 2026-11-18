import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { readXlsx } from "../../src/dwh/xlsx.ts";
import { parseCsv } from "../../src/stitch/stitch.ts";

/** Minimal ZIP writer for fixtures: each entry stored (method 0) or deflated (method 8). */
function zip(entries: { name: string; text: string; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.text, "utf8");
    const data = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, "utf8");
    const method = e.deflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function workbook(sheetXml: string, opts: { shared?: string[]; styles?: string; date1904?: boolean } = {}): Buffer {
  const files = [
    { name: "[Content_Types].xml", text: '<?xml version="1.0"?><Types/>' },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${opts.date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="Result" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: '<?xml version="1.0"?><Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/data.xml"/></Relationships>',
    },
    { name: "xl/worksheets/data.xml", text: `<?xml version="1.0"?><worksheet><sheetData>${sheetXml}</sheetData></worksheet>`, deflate: true },
  ];
  if (opts.shared)
    files.push({ name: "xl/sharedStrings.xml", text: `<?xml version="1.0"?><sst>${opts.shared.map((s) => `<si>${s}</si>`).join("")}</sst>`, deflate: true });
  if (opts.styles) files.push({ name: "xl/styles.xml", text: opts.styles });
  return zip(files);
}

test("xlsx and csv of the same data give the same table", () => {
  const shared = ["<t>z_wp_id</t>", "<t>z_wp_no</t>", "<t>z_wp_station</t>", '<t xml:space="preserve">A&amp;B </t>', "<r><t>Kiểm </t></r><r><rPr/><t>tra</t></r>", "<t>Line1_x000D_\nLine2</t>"];
  const sheet =
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2"><v>1797490</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
    '<row r="3"><c r="A3"><v>0.30000000000000004</v></c><c r="C3" t="inlineStr"><is><t>HAN</t></is></c></row>' +
    '<row r="4"><c r="A4" t="str"><v>x</v></c><c r="B4" t="s"><v>5</v></c><c r="C4" s="0"/></row>';
  const fromXlsx = readXlsx(workbook(sheet, { shared }));
  const fromCsv = parseCsv('z_wp_id,z_wp_no,z_wp_station\r\n1797490,A&B ,Kiểm tra\r\n0.30000000000000004,,HAN\r\nx,"Line1\r\nLine2",\r\n');
  assert.deepEqual(fromXlsx, fromCsv);
});

test("xlsx NULL-as-space cell stays a single space", () => {
  const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t xml:space="preserve"> </t></is></c></row>';
  assert.deepEqual(readXlsx(workbook(sheet)).rows, [["1", " "]]);
});

test("xlsx date-styled numbers become ISO dates and timestamps", () => {
  const styles =
    '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>' +
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';
  const sheet =
    '<row r="1"><c r="A1" t="inlineStr"><is><t>d</t></is></c><c r="B1" t="inlineStr"><is><t>ts</t></is></c><c r="C1" t="inlineStr"><is><t>n</t></is></c></row>' +
    '<row r="2"><c r="A2" s="1"><v>46336</v></c><c r="B2" s="2"><v>46336.25</v></c><c r="C2" s="0"><v>46336</v></c></row>';
  assert.deepEqual(readXlsx(workbook(sheet, { styles })).rows, [["2026-11-10", "2026-11-10 06:00:00", "46336"]]);
});

test("xlsx with the 1904 date system", () => {
  const styles = '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>';
  const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>d</t></is></c></row><row r="2"><c r="A2" s="1"><v>44874</v></c></row>';
  assert.deepEqual(readXlsx(workbook(sheet, { styles, date1904: true })).rows, [["2026-11-10"]]);
});

test("a file that is not an xlsx gets a plain error", () => {
  assert.throws(() => readXlsx(Buffer.from("z_wp_id,z_wp_no\r\n1,A\r\n")), /not an Excel \(\.xlsx\) file/);
});

test("a part that inflates past the limit is refused with a plain message (zip bomb)", () => {
  const big = `<row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(200_000)}</t></is></c></row>`;
  assert.throws(() => readXlsx(workbook(big), { maxInflated: 100_000 }), /too large/);
  assert.equal(readXlsx(workbook(big), { maxInflated: 1_000_000 }).header[0]!.length, 200_000);
});

test("parts the reader does not use are never inflated", () => {
  const files = zip([
    { name: "xl/workbook.xml", text: '<workbook><sheets><sheet name="R" sheetId="1"/></sheets></workbook>' },
    { name: "xl/worksheets/sheet1.xml", text: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row></sheetData></worksheet>' },
    { name: "xl/media/huge.bin", text: "y".repeat(500_000), deflate: true },
  ]);
  assert.deepEqual(readXlsx(files, { maxInflated: 10_000 }).header, ["a"]);
});

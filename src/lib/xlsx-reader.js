// Minimal, dependency-free .xlsx reader.
//
// An .xlsx is a zip of XML parts. We read the zip central directory, inflate
// the parts we need with DecompressionStream('deflate-raw'), and pull cell
// values out with regexes rather than DOMParser — sheet XML is machine-written
// and regular, and this way the same code runs in the popup and under node --test.
//
// Only cached values are read. Excel stores the last computed result of every
// formula in <v>, so whatever the Settings sheet produced at save time is what
// we get — no formula evaluation needed.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  // ------------------------------------------------------------------ zip

  function readZipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // End-of-central-directory record: scan back from the end for its signature.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not an .xlsx file (no zip directory found)');

    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder();

    for (let n = 0; n < count; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

      entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }

    async function read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + entry.compressedSize);

      if (entry.method === 0) return decoder.decode(data);
      if (entry.method !== 8) throw new Error(`Unsupported zip compression ${entry.method} for ${name}`);

      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    }

    return { names: [...entries.keys()], read };
  }

  // ------------------------------------------------------------------ xml

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function unescapeXml(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return String.fromCodePoint(n);
      }
      return ENTITIES[code] ?? match;
    });
  }

  function attr(tag, name) {
    const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return match ? unescapeXml(match[1]) : null;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let si;
    while ((si = siRe.exec(xml))) {
      // Rich text splits a string across several <t> runs; concatenate them.
      let text = '';
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(si[1]))) text += t[1];
      out.push(unescapeXml(text));
    }
    return out;
  }

  // "AB12" -> 27 (1-based column index)
  function columnIndex(ref) {
    let n = 0;
    for (const ch of ref) {
      const code = ch.charCodeAt(0);
      if (code < 65 || code > 90) break;
      n = n * 26 + code - 64;
    }
    return n;
  }

  // ---------------------------------------------------------------- styles

  // Excel's default 64-colour palette, used when a workbook doesn't override it.
  const DEFAULT_INDEXED = (
    '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF ' +
    '800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF ' +
    '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 ' +
    '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333'
  ).split(' ');

  /** Font colour ("RRGGBB" or null) for each cellXfs style index. */
  function parseFontColors(xml) {
    if (!xml) return [];
    const custom = (xml.match(/<indexedColors>([\s\S]*?)<\/indexedColors>/) || [])[1];
    const indexed = custom
      ? (custom.match(/<rgbColor\b[^>]*>/g) || []).map((tag) => (attr(tag, 'rgb') || '').slice(-6))
      : DEFAULT_INDEXED;

    const fontsXml = (xml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/) || [])[1] || '';
    const fontColors = (fontsXml.match(/<font(?:\s[^>]*?)?\/>|<font(?:\s[^>]*)?>[\s\S]*?<\/font>/g) || []).map((font) => {
      const color = font.match(/<color\b[^>]*>/);
      if (!color) return null;
      const rgb = attr(color[0], 'rgb');
      if (rgb) return rgb.slice(-6).toUpperCase();
      const index = attr(color[0], 'indexed');
      if (index !== null && indexed[Number(index)]) return indexed[Number(index)].toUpperCase();
      return null; // theme colours aren't resolved; nothing here relies on them
    });

    const xfsXml = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    return (xfsXml.match(/<xf\b[^>]*>/g) || []).map((xf) => fontColors[Number(attr(xf, 'fontId') || 0)] || null);
  }

  // Returns rows as sparse arrays indexed by 0-based column; values are strings.
  // With a `formulas` array, also fills formulas[row][col] with formula text
  // (shared-formula followers have no text of their own and are left empty).
  // With `colors` (and the style table), fills colors[row][col] with font colour.
  function parseSheet(xml, shared, formulas, colors, styleColors) {
    const rows = [];
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let row;
    while ((row = rowRe.exec(xml))) {
      const rowNumber = parseInt(attr(row[1], 'r'), 10);
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cell;
      while ((cell = cellRe.exec(row[2]))) {
        const ref = attr(cell[1], 'r');
        const type = attr(cell[1], 't');
        const body = cell[2] || '';
        let value = null;

        if (type === 'inlineStr') {
          const t = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
          value = t ? unescapeXml(t[1]) : null;
        } else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          if (v) value = type === 's' ? shared[parseInt(v[1], 10)] : unescapeXml(v[1]);
        }
        if (value !== null && value !== '') cells[columnIndex(ref) - 1] = value;
        if (colors) {
          const color = styleColors[Number(attr(cell[1], 's') || 0)];
          if (color) (colors[rowNumber - 1] = colors[rowNumber - 1] || [])[columnIndex(ref) - 1] = color;
        }
        if (formulas) {
          const f = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
          if (f && f[1]) (formulas[rowNumber - 1] = formulas[rowNumber - 1] || [])[columnIndex(ref) - 1] = unescapeXml(f[1]);
        }
      }
      rows[rowNumber - 1] = cells;
    }
    return rows;
  }

  // ------------------------------------------------------------------ api

  /**
   * @param buffer ArrayBuffer of the .xlsx
   * @param sheetNames names of the sheets to read
   * @param formulaSheets names of sheets whose formula text is also wanted
   * @param colorSheets names of sheets whose cell font colours are also wanted
   * @returns { [sheetName]: rows[][], formulas: { [sheetName]: string[][] },
   *            colors: { [sheetName]: string[][] } } (missing sheets omitted)
   */
  async function readSheets(buffer, sheetNames, formulaSheets = [], colorSheets = []) {
    const zip = readZipEntries(buffer);
    const workbook = await zip.read('xl/workbook.xml');
    const rels = await zip.read('xl/_rels/workbook.xml.rels');
    if (!workbook || !rels) throw new Error('Not an Excel workbook');

    const targets = new Map();
    for (const rel of rels.match(/<Relationship\b[^>]*>/g) || []) {
      targets.set(attr(rel, 'Id'), attr(rel, 'Target'));
    }

    const shared = parseSharedStrings(await zip.read('xl/sharedStrings.xml'));
    const out = { formulas: {}, colors: {} };
    const styleColors = colorSheets.length ? parseFontColors(await zip.read('xl/styles.xml')) : [];

    for (const sheetTag of workbook.match(/<sheet\b[^>]*>/g) || []) {
      const name = attr(sheetTag, 'name');
      if (!sheetNames.includes(name)) continue;
      let target = targets.get(attr(sheetTag, 'r:id'));
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      const xml = await zip.read(target);
      if (!xml) continue;
      const formulas = formulaSheets.includes(name) ? [] : null;
      const colors = colorSheets.includes(name) ? [] : null;
      out[name] = parseSheet(xml, shared, formulas, colors, styleColors);
      if (formulas) out.formulas[name] = formulas;
      if (colors) out.colors[name] = colors;
    }
    return out;
  }

  const api = { readSheets, columnIndex };
  YDR.xlsx = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis.YDR);

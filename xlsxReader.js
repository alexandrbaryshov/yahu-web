// Минимальный читатель .xlsx на встроенных модулях Node.js (без npm-зависимостей).
// Работает с обычными (не потоковыми) файлами, которые пишет openpyxl/Excel:
// парсит ZIP через центральный каталог и вытаскивает xl/sharedStrings.xml
// и первый лист xl/worksheets/sheet1.xml, затем читает их простым regex-парсингом.
const fs = require('fs');
const zlib = require('zlib');

function findEOCD(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === sig[0] && buf[i + 1] === sig[1] && buf[i + 2] === sig[2] && buf[i + 3] === sig[3]) {
      return i;
    }
  }
  throw new Error('Не найден конец центрального каталога ZIP (файл повреждён?)');
}

function readCentralDirectory(buf) {
  const eocd = findEOCD(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = {};
  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries[name] = { compressionMethod, compressedSize, localHeaderOffset };
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const lh = entry.localHeaderOffset;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return raw;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(raw);
  throw new Error('Неподдерживаемый метод сжатия в xlsx: ' + entry.compressionMethod);
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml))) {
    const block = m[1];
    const parts = [];
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRegex.exec(block))) parts.push(decodeXmlEntities(tm[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function colLetterToIndex(letters) {
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1; // 0-based
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRegex.exec(xml))) {
    const rowXml = rm[1];
    const cells = [];
    const cellRegex = /<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(?:<f>[\s\S]*?<\/f>)?(?:<v>([\s\S]*?)<\/v>)?(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g;
    let cm;
    while ((cm = cellRegex.exec(rowXml))) {
      const [, col, type, v, inlineStr] = cm;
      const colIdx = colLetterToIndex(col);
      let value;
      if (inlineStr !== undefined) {
        value = decodeXmlEntities(inlineStr);
      } else if (v === undefined) {
        value = undefined;
      } else if (type === 's') {
        value = sharedStrings[parseInt(v, 10)];
      } else {
        const num = Number(v);
        value = Number.isNaN(num) ? v : num;
      }
      cells[colIdx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Читает первый лист xlsx-файла и возвращает массив объектов,
 * где ключи — заголовки из первой строки.
 */
function readXlsxAsObjects(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = readCentralDirectory(buf);

  const sheetEntryName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(entries).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetEntryName) throw new Error('Лист не найден в xlsx');

  const sheetXml = extractEntry(buf, entries[sheetEntryName]).toString('utf8');
  let sharedStrings = [];
  if (entries['xl/sharedStrings.xml']) {
    const sstXml = extractEntry(buf, entries['xl/sharedStrings.xml']).toString('utf8');
    sharedStrings = parseSharedStrings(sstXml);
  }

  const rows = parseSheet(sheetXml, sharedStrings);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => (h === undefined ? '' : String(h).trim()));
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
    if (Object.values(obj).some((v) => v !== undefined && v !== '')) objects.push(obj);
  }
  return objects;
}

module.exports = { readXlsxAsObjects };

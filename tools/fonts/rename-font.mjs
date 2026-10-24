// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors

function checksum(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 4) sum = (sum + buffer.readUInt32BE(i)) >>> 0;
  return sum;
}

/** Rewrite the SFNT name table, retaining upstream legal records. Repack tables
 * and recalculate checksums, including head.checkSumAdjustment (OpenType spec). */
export function renameFont(source, licenseText) {
  const count = source.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const pos = 12 + i * 16;
    const tag = source.toString("ascii", pos, pos + 4);
    const offset = source.readUInt32BE(pos + 8);
    let data = Buffer.from(source.subarray(offset, offset + source.readUInt32BE(pos + 12)));
    if (tag === "name") {
      if (data.readUInt16BE(0) !== 0) throw new Error("Expected pinned name table format 0");
      const names = data.readUInt16BE(2);
      const start = data.readUInt16BE(4);
      const header = Buffer.from(data.subarray(0, 6 + names * 12));
      const strings = [];
      let size = 0;
      for (let j = 0; j < names; j++) {
        const rec = 6 + j * 12;
        const platform = data.readUInt16BE(rec);
        const id = data.readUInt16BE(rec + 6);
        const bytes = data.subarray(start + data.readUInt16BE(rec + 10), start + data.readUInt16BE(rec + 10) + data.readUInt16BE(rec + 8));
        const unicode = platform === 0 || platform === 3;
        let text = unicode ? Buffer.from(bytes).swap16().toString("utf16le") : bytes.toString("latin1");
        if ([1, 4, 16].includes(id)) text = "GTEki Sign JP";
        else if ([6, 25].includes(id)) text = "GTEkiSignJP";
        else if (id === 3) text = "GTEkiSignJP-2.004-subset";
        else if (id === 13) text += `\n\n${licenseText}`;
        else if (id >= 256) text = text.replaceAll("NotoSansJP", "GTEkiSignJP");
        const encoded = unicode ? Buffer.from(text, "utf16le").swap16() : Buffer.from(text, "latin1");
        header.writeUInt16BE(encoded.length, rec + 8);
        header.writeUInt16BE(size, rec + 10);
        strings.push(encoded);
        size += encoded.length;
      }
      header.writeUInt16BE(header.length, 4);
      data = Buffer.concat([header, ...strings]);
    }
    if (tag === "head") data.writeUInt32BE(0, 8);
    tables.push({ tag, data });
  }
  let offset = 12 + count * 16;
  const output = Buffer.alloc(offset + tables.reduce((n, t) => n + ((t.data.length + 3) & ~3), 0));
  source.copy(output, 0, 0, 12);
  let headOffset;
  tables.forEach(({ tag, data }, i) => {
    const pos = 12 + i * 16;
    output.write(tag, pos, "ascii");
    output.writeUInt32BE(offset, pos + 8);
    output.writeUInt32BE(data.length, pos + 12);
    data.copy(output, offset);
    output.writeUInt32BE(checksum(output.subarray(offset, offset + ((data.length + 3) & ~3))), pos + 4);
    if (tag === "head") headOffset = offset;
    offset += (data.length + 3) & ~3;
  });
  if (headOffset === undefined) throw new Error("Missing head table");
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  return output;
}

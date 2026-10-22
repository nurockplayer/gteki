// ZIP member names without the UTF-8 flag are legacy-encoded. The ZIP specification
// decodes them as CP437, which yields mojibake for Japanese archives written in CP932.
// The raw bytes stay the member identity; every decoding is recorded as evidence only.
/** Identical to the yauzl 3.4.0 CP437 table (control bytes map to graphic symbols, 0xFF to NBSP). */
const CP437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

export type ZipNameEncodingStatus = 'DECLARED_UTF8' | 'DECLARED_UNICODE_PATH_EXTRA' | 'ASCII_ONLY' | 'CANDIDATE_CP932_UNDECLARED' | 'UNDECLARED_UNRESOLVED';
export type ZipNameInfo = {
  /** Raw central-directory name bytes as lowercase hex: the stable member identity. */
  name_bytes_hex: string;
  name_utf8_flag: boolean;
  name_encoding_status: ZipNameEncodingStatus;
  /** Specification decoding when the UTF-8 flag is absent; null when UTF-8 is declared. */
  name_cp437: string | null;
  /** UTF-8 decoding, only when the UTF-8 flag is declared. */
  name_utf8: string | null;
  /** Only when the flag is absent and the bytes decode as valid CP932. A candidate, never a declaration. */
  name_cp932_candidate: string | null;
};

export function decodeCp437(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += CP437[byte] ?? '';
  return result;
}

export function decodeCp932Strict(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    return text.includes('�') || /[\u0000-\u001f\u007f]/.test(text) ? null : text;
  } catch { return null; }
}

/** Describe a ZIP member name without assuming an undeclared encoding. */
export function describeZipName(raw: Uint8Array, utf8Flag: boolean, specName?: string): ZipNameInfo {
  const bytes = Buffer.from(raw);
  const name_bytes_hex = bytes.toString('hex');
  if (utf8Flag) return { name_bytes_hex, name_utf8_flag: true, name_encoding_status: 'DECLARED_UTF8', name_cp437: null, name_utf8: bytes.toString('utf8'), name_cp932_candidate: null };
  const name_cp437 = decodeCp437(bytes);
  if (specName !== undefined && specName !== name_cp437 && specName !== name_cp437.replaceAll('\\', '/'))
    return { name_bytes_hex, name_utf8_flag: false, name_encoding_status: 'DECLARED_UNICODE_PATH_EXTRA', name_cp437, name_utf8: specName, name_cp932_candidate: null };
  if (bytes.every(byte => byte < 0x80)) return { name_bytes_hex, name_utf8_flag: false, name_encoding_status: 'ASCII_ONLY', name_cp437, name_utf8: null, name_cp932_candidate: null };
  const candidate = decodeCp932Strict(bytes);
  return { name_bytes_hex, name_utf8_flag: false, name_encoding_status: candidate === null ? 'UNDECLARED_UNRESOLVED' : 'CANDIDATE_CP932_UNDECLARED', name_cp437, name_utf8: null, name_cp932_candidate: candidate };
}

/** Human-readable member label; a CP932 candidate is always labelled as a candidate. */
export function displayZipMemberName(member: { file?: unknown; name?: unknown; name_encoding_status?: unknown; name_cp932_candidate?: unknown }): string {
  const name = String(member.file ?? member.name ?? '');
  return member.name_encoding_status === 'CANDIDATE_CP932_UNDECLARED' && typeof member.name_cp932_candidate === 'string'
    ? `${name} [name bytes undeclared; CP932 candidate: ${member.name_cp932_candidate}]`
    : name;
}

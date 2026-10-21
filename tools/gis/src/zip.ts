import { posix } from 'node:path';
import yauzl from 'yauzl';

export type ZipEntry = { name: string; data: Buffer };
export type ZipReadOptions = { maxEntryBytes?: number; maxTotalBytes?: number; legacyFileNameEncoding?: 'shift_jis' };
const DEFAULT_ENTRY_LIMIT = 128 * 1024 * 1024;
const DEFAULT_TOTAL_LIMIT = 512 * 1024 * 1024;

function validateEntryName(name: string): void {
  const normalized = name.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`ZIP contains an absolute entry path: ${name}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) throw new Error(`ZIP contains a parent path segment: ${name}`);
  if (posix.normalize(normalized).startsWith('../')) throw new Error(`ZIP entry escapes its root: ${name}`);
}

export async function readZip(path: string, options: ZipReadOptions = {}): Promise<ZipEntry[]> {
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_ENTRY_LIMIT;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_TOTAL_LIMIT;
  if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 0 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) {
    throw new Error('ZIP size limits must be non-negative safe integers');
  }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: !options.legacyFileNameEncoding, validateEntrySizes: true }, (error, opened) => {
      if (error || !opened) reject(error ?? new Error(`Unable to open ZIP: ${path}`));
      else resolve(opened);
    });
  });

  return new Promise<ZipEntry[]>((resolve, reject) => {
    const entries: ZipEntry[] = [];
    let totalBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    });
    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        if (options.legacyFileNameEncoding) {
          const raw = entry.fileName as unknown as Buffer;
          entry.fileName = new TextDecoder(entry.generalPurposeBitFlag & 0x800 ? 'utf-8' : options.legacyFileNameEncoding, { fatal: true }).decode(raw);
        }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
      try { validateEntryName(entry.fileName); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
      if (entry.isEncrypted()) { fail(new Error(`Encrypted ZIP entry is not accepted: ${entry.fileName}`)); return; }
      const unixMode = entry.externalFileAttributes >>> 16;
      if ((unixMode & 0o170000) === 0o120000) { fail(new Error(`Symbolic-link ZIP entry is not accepted: ${entry.fileName}`)); return; }
      if (entry.uncompressedSize > maxEntryBytes) { fail(new Error(`ZIP entry exceeds size limit: ${entry.fileName}`)); return; }
      if (totalBytes + entry.uncompressedSize > maxTotalBytes) { fail(new Error(`ZIP archive exceeds total size limit at: ${entry.fileName}`)); return; }
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(error ?? new Error(`Unable to read ZIP entry: ${entry.fileName}`)); return; }
        const chunks: Buffer[] = [];
        let entryBytes = 0;
        stream.on('data', (chunk: Buffer) => {
          entryBytes += chunk.length;
          if (entryBytes > maxEntryBytes || totalBytes + entryBytes > maxTotalBytes) {
            stream.destroy(new Error(`ZIP entry exceeded actual size limits: ${entry.fileName}`));
          } else chunks.push(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (settled) return;
          totalBytes += entryBytes;
          entries.push({ name: entry.fileName, data: Buffer.concat(chunks, entryBytes) });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

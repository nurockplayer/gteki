import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot } from './common.js';

/** Keep prior receipts under history while each current receipt has one stable path. */
export async function archiveReceipt(name: 'real-run' | 'validation'): Promise<void> {
  let bytes: Buffer;
  try { bytes = await readFile(join(docsRoot, 'gis', `${name}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const old = JSON.parse(bytes.toString('utf8')) as { started_at?: string };
  const tag = (old.started_at ?? 'undated').replace(/[^\dA-Za-z-]/g, '-');
  const directory = join(docsRoot, 'gis', 'history', 'runs');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}-${tag}.json`), bytes);
}

/** Move conversion receipts produced by a different tool fingerprint out of the current receipt directory. */
export async function archiveStaleConversions(currentFingerprint: string, gisRoot = join(docsRoot, 'gis')): Promise<string[]> {
  const current = join(gisRoot, 'conversions');
  let files: string[];
  try { files = (await readdir(current)).filter((file) => file.endsWith('.json')).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const moved: string[] = [];
  for (const file of files) {
    const receipt = JSON.parse(await readFile(join(current, file), 'utf8')) as { semantic_inputs?: { tool_input_sha256?: string } };
    const fingerprint = receipt.semantic_inputs?.tool_input_sha256 ?? 'unknown';
    if (fingerprint === currentFingerprint) continue;
    const directory = join(gisRoot, 'history', 'conversions', `tool-${fingerprint.slice(0, 16)}`);
    await mkdir(directory, { recursive: true });
    await rename(join(current, file), join(directory, file));
    moved.push(file);
  }
  return moved;
}

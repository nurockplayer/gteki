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

/**
 * Move every existing conversion receipt to history (grouped by its tool fingerprint) before a real run converts,
 * so the current directory holds only receipts produced by that run, even when an older or out-of-band receipt
 * shares the current fingerprint.
 */
export async function archivePriorConversions(gisRoot = join(docsRoot, 'gis')): Promise<string[]> {
  const current = join(gisRoot, 'conversions');
  let files: string[];
  try { files = (await readdir(current)).filter((file) => file.endsWith('.json')).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const moved: string[] = [];
  for (const file of files) {
    const receipt = JSON.parse(await readFile(join(current, file), 'utf8')) as { semantic_inputs?: { tool_input_sha256?: string } };
    const fingerprint = receipt.semantic_inputs?.tool_input_sha256 ?? 'unknown';
    const directory = join(gisRoot, 'history', 'conversions', `tool-${fingerprint.slice(0, 16)}`);
    await mkdir(directory, { recursive: true });
    await rename(join(current, file), join(directory, file));
    moved.push(file);
  }
  return moved;
}

/**
 * A report-writing command run outside `real-run` makes the current real-run receipt stale: mark it invalidated so
 * `summarize` refuses to mix out-of-band artifacts with the receipt's run.
 */
export async function invalidateRealRunReceipt(command: string, gisRoot = join(docsRoot, 'gis')): Promise<boolean> {
  const path = join(gisRoot, 'real-run.json');
  let receipt: Record<string, unknown>;
  try { receipt = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  receipt.invalidated = { at: new Date().toISOString(), by_command: command, reason: 'Report-writing command run outside real-run; rerun real-run before summarizing' };
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return true;
}

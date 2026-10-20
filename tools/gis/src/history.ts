import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

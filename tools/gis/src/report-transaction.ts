import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

/** Null content retires an existing generated record as part of the same bundle. */
export type ReportFile = { path: string; content: string | null };

/** Prepare every output before promotion; restore the previous bundle on an I/O error.
 * Multi-file visibility is not a filesystem transaction across process/host crashes.
 */
export async function commitReportFiles(files: ReportFile[], root: string): Promise<void> {
  const paths = new Set<string>();
  const previous: Array<Buffer | null> = [];
  // Read/validate all destinations before staging or modifying any report.
  for (const file of files) {
    const path = relative(root, file.path);
    if (!path || path === '..' || path.startsWith('../') || isAbsolute(path) || paths.has(file.path)) throw new Error('Invalid or duplicate report destination');
    paths.add(file.path);
    try {
      if (!(await lstat(file.path)).isFile()) throw new Error(`Report destination is not a regular file: ${file.path}`);
      previous.push(await readFile(file.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      previous.push(null);
    }
  }
  const stage = await mkdtemp(join(root, '.report-stage-'));
  const promoted: number[] = [];
  try {
    for (const [i, file] of files.entries()) {
      if (file.content !== null) await writeFile(join(stage, `${i}.new`), file.content, { flag: 'wx' });
      if (previous[i] !== null) await writeFile(join(stage, `${i}.old`), previous[i]!, { flag: 'wx' });
    }
    for (const [i, file] of files.entries()) {
      await mkdir(dirname(file.path), { recursive: true });
      if (file.content === null) await rm(file.path, { force: true });
      else await rename(join(stage, `${i}.new`), file.path);
      promoted.push(i);
    }
  } catch (error) {
    for (const i of promoted.reverse()) {
      if (previous[i] === null) await rm(files[i]!.path, { force: true });
      else await rename(join(stage, `${i}.old`), files[i]!.path);
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

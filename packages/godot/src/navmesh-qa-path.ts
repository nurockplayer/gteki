import fs from "node:fs";
import path from "node:path";

/** Resolve an output directory under the real repository .qa directory. */
export function qaDirectory(directory: string): string {
  const repo = fs.realpathSync(process.cwd()), qa = path.join(repo, ".qa"), dest = path.resolve(directory);
  if (dest !== qa && !dest.startsWith(qa + path.sep)) throw new Error("output must be under .qa/");
  fs.mkdirSync(qa, { recursive: true });
  if (fs.realpathSync(qa) !== qa) throw new Error(".qa must not be a symlink");
  fs.mkdirSync(dest, { recursive: true });
  const real = fs.realpathSync(dest);
  if (real !== qa && !real.startsWith(qa + path.sep)) throw new Error("output resolves outside .qa/");
  return real;
}

/** Reject an existing symlink at the file itself as well as escaped parents. */
export function qaFile(file: string): string {
  const dir = qaDirectory(path.dirname(path.resolve(file))), dest = path.join(dir, path.basename(file));
  try { if (fs.lstatSync(dest).isSymbolicLink()) throw new Error("output file must not be a symlink"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return dest;
}

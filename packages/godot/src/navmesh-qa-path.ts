import fs from "node:fs";
import path from "node:path";

/** The QA output root: the repository's .qa, or GTEKI_PRIVATE_DIR's .qa when a private overlay is loaded, so private-derived meshes and audits never land in the repository (#669 r3). */
export function qaRoot(privateDir = process.env.GTEKI_PRIVATE_DIR): string {
  return path.join(fs.realpathSync(privateDir || process.cwd()), ".qa");
}

/** Resolve an output directory under the real QA root (see qaRoot). */
export function qaDirectory(directory: string, privateDir = process.env.GTEKI_PRIVATE_DIR): string {
  const qa = qaRoot(privateDir), dest = path.resolve(directory);
  if (dest !== qa && !dest.startsWith(qa + path.sep)) throw new Error(privateDir ? "output must be under GTEKI_PRIVATE_DIR/.qa/" : "output must be under .qa/");
  fs.mkdirSync(qa, { recursive: true });
  if (fs.realpathSync(qa) !== qa) throw new Error(".qa must not be a symlink");
  // Check the deepest existing ancestor before creating anything, so a symlink escape creates no directory outside (#670 r3).
  let existing = dest; while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const realExisting = fs.realpathSync(existing);
  if (realExisting !== qa && !realExisting.startsWith(qa + path.sep)) throw new Error("output resolves outside .qa/");
  fs.mkdirSync(dest, { recursive: true });
  const real = fs.realpathSync(dest);
  if (real !== qa && !real.startsWith(qa + path.sep)) throw new Error("output resolves outside .qa/");
  return real;
}

/** Reject an existing symlink at the file itself as well as escaped parents. */
export function qaFile(file: string, privateDir = process.env.GTEKI_PRIVATE_DIR): string {
  const dir = qaDirectory(path.dirname(path.resolve(file)), privateDir), dest = path.join(dir, path.basename(file));
  try { if (fs.lstatSync(dest).isSymbolicLink()) throw new Error("output file must not be a symlink"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return dest;
}

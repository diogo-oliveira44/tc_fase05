import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object keys are `<incident>/<uuid>.<ext>` and are generated here, never taken
 * from the client, so an uploaded name cannot escape the upload directory.
 */
export async function store(
  directory: string,
  key: string,
  data: Buffer,
): Promise<void> {
  const target = path.resolve(directory, key);
  await mkdir(path.dirname(target), { recursive: true });
  // `wx` fails instead of overwriting, should a key ever collide.
  await writeFile(target, data, { flag: "wx" });
}

export const read = (directory: string, key: string) =>
  readFile(path.resolve(directory, key));

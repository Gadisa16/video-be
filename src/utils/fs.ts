import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function removeDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function cleanDirectory(dir: string) {
  await removeDir(dir);
  await ensureDir(dir);
}

export async function findFirstFile(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) return path.join(dir, entry.name);
  }
  return null;
}

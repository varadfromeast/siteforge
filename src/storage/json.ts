import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from './atomic-write.js';

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJson(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
): Promise<void> {
  const encoded = JSON.stringify(value, null, 2);
  if (encoded === undefined) {
    throw new Error(`Cannot serialize undefined as JSON: ${filePath}`);
  }
  await atomicWriteFile(filePath, `${encoded}\n`, options);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

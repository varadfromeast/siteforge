import { randomBytes } from 'node:crypto';
import { open, rename, unlink, mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AtomicWriteOptions {
  mode?: number;
}

export async function atomicWriteFile(
  filePath: string,
  data: string,
  options?: AtomicWriteOptions,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`;
  let handle: FileHandle | undefined;

  try {
    handle = await open(tmpPath, 'w', options?.mode ?? 0o600);
    await handle.writeFile(data, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    await rename(tmpPath, filePath);
    await fsyncDir(dirname(filePath));
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

async function fsyncDir(dirPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dirPath, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every platform/filesystem. The file
    // itself has already been fsynced, so this is a best-effort durability bump.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

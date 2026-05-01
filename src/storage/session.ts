import type { Domain } from '../core/types.js';
import { readJson, writeJson } from './json.js';
import { sessionPath, type StorageOptions } from './paths.js';

export async function loadSession(
  domain: Domain,
  options?: StorageOptions,
): Promise<unknown | null> {
  return readJson<unknown>(sessionPath(domain, options));
}

export async function saveSession(
  domain: Domain,
  state: unknown,
  options?: StorageOptions,
): Promise<void> {
  await writeJson(sessionPath(domain, options), state, { mode: 0o600 });
}

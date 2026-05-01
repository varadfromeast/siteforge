import { CURRENT_SCHEMA_VERSION } from '../core/index.js';
import type { Registry } from '../core/types.js';
import { readJson, writeJson } from './json.js';
import { registryPath, type StorageOptions } from './paths.js';
import { assertCurrentSchema } from './schema.js';

export async function loadRegistry(options?: StorageOptions): Promise<Registry> {
  const filePath = registryPath(options);
  const registry = await readJson<Registry>(filePath);
  if (!registry) {
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      entries: {},
    };
  }

  assertCurrentSchema(filePath, registry.schema_version);
  return registry;
}

export async function saveRegistry(
  registry: Registry,
  options?: StorageOptions,
): Promise<void> {
  assertCurrentSchema(registryPath(options), registry.schema_version);
  await writeJson(registryPath(options), registry, { mode: 0o600 });
}

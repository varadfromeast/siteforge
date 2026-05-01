import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Domain } from '../core/types.js';

export interface StorageOptions {
  /** Override the storage root. Defaults to `~/.siteforge`. */
  root?: string;
}

export function storageRoot(options?: StorageOptions): string {
  return resolve(options?.root ?? join(homedir(), '.siteforge'));
}

export function normalizeDomain(domain: Domain): Domain {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) throw new Error('domain must not be empty');

  const hostname = trimmed.includes('://') ? new URL(trimmed).hostname : trimmed;
  const normalized = hostname.replace(/\.$/, '');

  if (!normalized) throw new Error('domain must not be empty');
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`domain must be a hostname, got ${domain}`);
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('..')) {
    throw new Error(`domain contains unsafe path segments: ${domain}`);
  }
  if (normalized.startsWith('.') || normalized.endsWith('.')) {
    throw new Error(`domain must not start or end with ".": ${domain}`);
  }
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(`domain contains unsupported characters: ${domain}`);
  }

  return normalized;
}

export function siteDir(domain: Domain, options?: StorageOptions): string {
  return join(storageRoot(options), 'sites', normalizeDomain(domain));
}

export function registryPath(options?: StorageOptions): string {
  return join(storageRoot(options), 'registry.json');
}

export function graphPath(domain: Domain, options?: StorageOptions): string {
  return join(siteDir(domain, options), 'graph.json');
}

export function metaPath(domain: Domain, options?: StorageOptions): string {
  return join(siteDir(domain, options), 'meta.json');
}

export function sessionPath(domain: Domain, options?: StorageOptions): string {
  return join(siteDir(domain, options), 'session.json');
}

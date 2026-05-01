/**
 * @module storage
 *
 * Public storage API. Filesystem JSON only, with atomic temp+rename writes.
 */

export { SchemaVersionError } from './errors.js';
export type { StorageOptions } from './paths.js';
export { siteDir, storageRoot } from './paths.js';
export { loadGraph, saveGraph } from './graph.js';
export { loadSession, saveSession } from './session.js';
export { loadRegistry, saveRegistry } from './registry.js';

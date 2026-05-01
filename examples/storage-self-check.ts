/**
 * Storage self-check — validates filesystem round-trips without touching
 * the real ~/.siteforge directory.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION, type SiteGraph } from '../src/core/index.js';
import {
  SchemaVersionError,
  loadGraph,
  loadRegistry,
  loadSession,
  saveGraph,
  saveSession,
  siteDir,
} from '../src/storage/index.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const root = await mkdtemp(join(tmpdir(), 'siteforge-storage-'));

try {
  console.log('\n[storage] paths');
  assert(
    siteDir('https://Instagram.com/someone/', { root }).endsWith('/sites/instagram.com'),
    'siteDir normalizes URL input to hostname',
  );

  let unsafePathRejected = false;
  try {
    siteDir('../evil', { root });
  } catch {
    unsafePathRejected = true;
  }
  assert(unsafePathRejected, 'siteDir rejects path traversal');

  console.log('\n[storage] empty reads');
  assert((await loadGraph('instagram.com', { root })) === null, 'missing graph returns null');
  assert(
    deepEqual(await loadRegistry({ root }), { schema_version: CURRENT_SCHEMA_VERSION, entries: {} }),
    'missing registry returns empty registry',
  );

  console.log('\n[storage] session round-trip');
  const session = { cookies: [{ name: 'sid', value: 'local-only' }], origins: [] };
  await saveSession('instagram.com', session, { root });
  assert(deepEqual(await loadSession('instagram.com', { root }), session), 'session round-trips');

  console.log('\n[storage] graph round-trip + registry');
  const graph: SiteGraph = {
    schema_version: CURRENT_SCHEMA_VERSION,
    domain: 'instagram.com',
    states: {
      abc: {
        id: 'abc',
        kind: 'page',
        label: 'Home',
        atoms: [{ role: 'button', accessible_name: 'search', attrs: {} }],
        confidence: 0.95,
        last_seen: '2026-05-01T00:00:00.000Z',
      },
    },
    edges: [],
    processes: {},
    clusters: {},
    meta: {
      last_indexed: '2026-05-01T00:00:00.000Z',
      drift_score: 0,
      states_count: 999,
      edges_count: 999,
    },
  };

  await saveGraph(graph, { root });
  const saved = await loadGraph('instagram.com', { root });
  assert(saved !== null, 'saved graph loads');
  assert(saved?.meta.states_count === 1, 'saveGraph refreshes states_count');
  assert(saved?.meta.edges_count === 0, 'saveGraph refreshes edges_count');

  const registry = await loadRegistry({ root });
  assert(registry.entries['instagram.com']?.stats.states === 1, 'saveGraph updates registry');
  assert(registry.entries['instagram.com']?.stats.edges === 0, 'registry edge count is current');

  const meta = JSON.parse(await readFile(join(root, 'sites', 'instagram.com', 'meta.json'), 'utf8')) as {
    states_count: number;
  };
  assert(meta.states_count === 1, 'saveGraph writes meta.json summary');

  console.log('\n[storage] schema guard');
  await mkdir(join(root, 'sites', 'future.example'), { recursive: true });
  await writeFile(
    join(root, 'sites', 'future.example', 'graph.json'),
    JSON.stringify({ ...graph, domain: 'future.example', schema_version: 999 }),
  );

  let schemaRejected = false;
  try {
    await loadGraph('future.example', { root });
  } catch (err) {
    schemaRejected = err instanceof SchemaVersionError;
  }
  assert(schemaRejected, 'future schema version is rejected');
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '✅ storage checks passed' : `❌ ${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);

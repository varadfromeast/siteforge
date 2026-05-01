import { CURRENT_SCHEMA_VERSION } from '../core/index.js';
import type { Domain, RegistryEntry, SiteGraph, SiteGraphMeta } from '../core/types.js';
import { readJson, writeJson } from './json.js';
import { graphPath, metaPath, normalizeDomain, siteDir, type StorageOptions } from './paths.js';
import { loadRegistry, saveRegistry } from './registry.js';
import { assertCurrentSchema } from './schema.js';

export async function loadGraph(
  domain: Domain,
  options?: StorageOptions,
): Promise<SiteGraph | null> {
  const filePath = graphPath(domain, options);
  const graph = await readJson<SiteGraph>(filePath);
  if (!graph) return null;

  assertCurrentSchema(filePath, graph.schema_version);
  return graph;
}

export async function saveGraph(
  graph: SiteGraph,
  options?: StorageOptions,
): Promise<void> {
  const domain = normalizeDomain(graph.domain);
  assertCurrentSchema(graphPath(domain, options), graph.schema_version);

  const meta = graphMeta(graph);
  const graphToSave: SiteGraph = {
    ...graph,
    domain,
    meta,
  };

  await writeJson(graphPath(domain, options), graphToSave, { mode: 0o600 });
  await writeJson(metaPath(domain, options), meta, { mode: 0o600 });

  const registry = await loadRegistry(options);
  registry.entries[domain] = registryEntry(graphToSave, options);
  await saveRegistry(registry, options);
}

function graphMeta(graph: SiteGraph): SiteGraphMeta {
  return {
    ...graph.meta,
    states_count: Object.keys(graph.states).length,
    edges_count: graph.edges.length,
  };
}

function registryEntry(graph: SiteGraph, options?: StorageOptions): RegistryEntry {
  return {
    domain: graph.domain,
    storage_path: siteDir(graph.domain, options),
    indexed_at: graph.meta.last_indexed,
    last_validated: graph.meta.last_validated,
    stats: {
      states: Object.keys(graph.states).length,
      edges: graph.edges.length,
      processes: Object.keys(graph.processes).length,
    },
  };
}

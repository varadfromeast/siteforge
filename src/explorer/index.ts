/**
 * @module explorer
 *
 * The teach loop. Proactively crawls a site to populate the SiteGraph
 * before any agent uses it.
 *
 * Pipeline (DAG, modeled after GitNexus's 12-phase indexer):
 *
 *   1. SETUP      — launch Stagehand (headed); load session.json or prompt
 *                   manual login; save session on success.
 *   2. SNAPSHOT   — captureSnapshot of current page.
 *   3. CLASSIFY   — atoms → state_id; assign kind; persist or merge.
 *   4. ENUMERATE  — for each interactable atom, generate a candidate Operation.
 *   5. VALIDATE   — execute candidates (single-flight, throttled, depth-bounded);
 *                   snapshot result; write Operation edge with validation_hash.
 *   6. CLUSTER    — Leiden over the edge graph → cluster_id per state.
 *   7. TRACE      — score entry points, BFS, name top processes.
 *
 * Cache theory parallels:
 *   - This is cache *warming* (proactive prefetch).
 *   - Single-flight per (domain, state_id) prevents stampede.
 *   - Throttled (1-3s between ops) for anti-detection.
 *
 * GitNexus parallel: `gitnexus analyze` — the offline indexer that runs
 * before any query. Stagehand has no equivalent; everything is reactive there.
 */

import type { Domain, SiteGraph } from '../core/types.js';

export interface ExploreOptions {
  /** Maximum BFS depth from the starting state. Default: 3. */
  max_depth?: number;
  /** Maximum operations to enumerate per state. Default: 8. */
  max_branching?: number;
  /** Time budget in milliseconds. Default: 5 minutes. */
  time_budget_ms?: number;
  /** Min/max delay between operations (anti-detection). Defaults to 1000-3000ms. */
  throttle_ms?: { min: number; max: number };
  /** Skip CLUSTER + TRACE phases for fast tests. */
  skip_post_processing?: boolean;
  /** Headless mode (only after session.json exists). Default: false (headed). */
  headless?: boolean;
}

export interface ExploreResult {
  graph: SiteGraph;
  stats: {
    states_discovered: number;
    edges_recorded: number;
    operations_executed: number;
    operations_failed: number;
    elapsed_ms: number;
  };
}

/**
 * Run the teach loop. Returns the final SiteGraph (also saved to disk via storage).
 * If a graph already exists for this domain, the explorer extends it.
 *
 * IMPLEMENTATION DEFERRED.
 */
export async function explore(
  domain: Domain,
  start_url: string,
  options?: ExploreOptions,
): Promise<ExploreResult> {
  throw new Error('explore: not implemented');
}

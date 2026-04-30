/**
 * @module runtime
 *
 * The run loop. Used at execution time when an agent invokes a CLI/MCP action.
 *
 * Sub-components:
 *   - PathPlanner  — BFS over SiteGraph (delegates to core/planPath)
 *   - Replayer     — execute a single Operation via Stagehand's
 *                    takeDeterministicAction. Detects drift via validation_hash.
 *   - SelfHealer   — on drift or Playwright exception, call Stagehand.act()
 *                    to re-resolve, write back updated edge.
 *
 * Cache theory parallels:
 *   - L1: in-memory SiteGraph map, evict after 5min idle.
 *   - L2: disk JSON (loaded by storage on miss).
 *   - L3 (origin): live LLM via Stagehand.act() on drift.
 *   - Drift detection: per-replay validation_hash check.
 *   - Single-flight on (domain, state_id, op_id) during execution.
 *   - Negative cache: "intent X unreachable from S" with 5min TTL.
 *
 * GitNexus parallel: this is the query-time layer (Cypher tools, impact
 * analysis). Stagehand parallel: AgentCache.replayCachedActions plus
 * takeDeterministicAction, but with drift detection bolted on.
 */

import type { Domain, ProcessName, StateId } from '../core/types.js';

// ---------------------------------------------------------------------------
// Run a single named process (= a CLI subcommand)
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Stop on first failure (true) or attempt self-heal and continue (false). */
  fail_fast?: boolean;
  /** Maximum self-heal attempts per failed step. Default: 2. */
  max_heals?: number;
  /** Headless mode. Default: false (so user can watch in v1). */
  headless?: boolean;
}

export interface RunResult {
  ok: boolean;
  process: ProcessName;
  /** Path actually taken — may differ from cached if self-heal kicked in. */
  steps_executed: Array<{
    op_id: string;
    healed: boolean;
    elapsed_ms: number;
  }>;
  /** Final observed state id. */
  ended_at: StateId;
  /** Structured payload extracted (if any). */
  output?: unknown;
  error?: string;
}

/**
 * Execute a named process from the SiteGraph.
 * IMPLEMENTATION DEFERRED.
 */
export async function runProcess(
  domain: Domain,
  process: ProcessName,
  args: Record<string, unknown>,
  options?: RunOptions,
): Promise<RunResult> {
  throw new Error('runProcess: not implemented');
}

// ---------------------------------------------------------------------------
// Run an arbitrary "find a path to state X and execute" — for ad-hoc agents
// ---------------------------------------------------------------------------

/**
 * Plan and execute a path from the current page to a target state.
 * Used by agents that want fine-grained navigation control.
 * IMPLEMENTATION DEFERRED.
 */
export async function navigateTo(
  domain: Domain,
  target: StateId,
  options?: RunOptions,
): Promise<RunResult> {
  throw new Error('navigateTo: not implemented');
}

// ---------------------------------------------------------------------------
// Validate a SiteGraph (drift check across known states)
// ---------------------------------------------------------------------------

export interface ValidateResult {
  states_checked: number;
  states_drifted: number;
  edges_quarantined: number;
  drift_score: number; // 0..1
}

/**
 * Walk the graph, snapshot each state's URL pattern, compare to expected
 * atom-set hash, mark drifted edges. Background task, called by `siteforge validate`.
 * IMPLEMENTATION DEFERRED.
 */
export async function validateGraph(domain: Domain): Promise<ValidateResult> {
  throw new Error('validateGraph: not implemented');
}

/**
 * @module emitters
 *
 * Compile a SiteGraph into agent-facing artifacts.
 *
 * Three emitters:
 *   - CLI emitter        → generates a per-site binary (`instagram-cli post`, etc.)
 *                          one subcommand per Process in the graph.
 *   - MCP emitter        → spins up an MCP server exposing resources + tools.
 *                          Resources (cheap reads, ~150-500 tokens):
 *                            site://<domain>/{context, states, state/<id>,
 *                                             process/<name>, clusters}
 *                          Tools (expensive, do work):
 *                            find_path, run_action, explore, validate
 *   - Skill.md emitter   → renders a markdown doc per Leiden cluster, listing
 *                          the cluster's processes and how to invoke them.
 *
 * GitNexus parallel: identical pattern. GitNexus emits a SKILL.md per
 * Leiden cluster, plus 16 MCP tools (cheap resources vs expensive tools).
 */

import type { Domain, SiteGraph } from '../core/types.js';

// ---------------------------------------------------------------------------
// CLI emitter
// ---------------------------------------------------------------------------

export interface CliEmitResult {
  /** Path to the generated CLI binary (or wrapper script). */
  binary_path: string;
  /** Subcommands generated, one per Process. */
  commands: Array<{ name: string; description: string; args: string[] }>;
}

/**
 * Emit a per-site CLI binary. Each Process becomes a subcommand.
 * IMPLEMENTATION DEFERRED.
 */
export async function emitCli(graph: SiteGraph): Promise<CliEmitResult> {
  throw new Error('emitCli: not implemented');
}

// ---------------------------------------------------------------------------
// MCP server emitter
// ---------------------------------------------------------------------------

export interface McpServerHandle {
  url: string;
  /** Stop the server. */
  close: () => Promise<void>;
}

/**
 * Start an MCP server exposing the SiteGraph as resources + tools.
 * IMPLEMENTATION DEFERRED.
 */
export async function startMcpServer(domain: Domain): Promise<McpServerHandle> {
  throw new Error('startMcpServer: not implemented');
}

// ---------------------------------------------------------------------------
// Skill.md emitter
// ---------------------------------------------------------------------------

/**
 * Render a markdown skill document per Leiden cluster.
 * Output: `~/.siteforge/sites/<domain>/skill.md` (single file with all clusters).
 * Format mirrors GitNexus's per-cluster SKILL.md (YAML frontmatter +
 * checklist + token-budgeted resource table).
 * IMPLEMENTATION DEFERRED.
 */
export async function emitSkillMd(graph: SiteGraph): Promise<string> {
  throw new Error('emitSkillMd: not implemented');
}

/**
 * Public data model. This is your primary abstraction surface.
 *
 * A site is a directed labeled multigraph:
 *   - States (nodes) are logical screens identified by atom-set hash.
 *   - Operations (edges) are interactions that transition between states.
 *   - Processes are named BFS-precomputed paths (= CLI subcommands).
 *   - Clusters are Leiden communities of densely-connected states.
 *
 * Inspired by GitNexus's hybrid schema (per-type node tables +
 * single relation table with type discriminator).
 */

/** Domain like "instagram.com". Used as the site identifier. */
export type Domain = string;

/** SHA-256 hash. Used everywhere we need a content-addressable id. */
export type Hash = string;

/** Stable id for a logical screen state. Hash of canonicalized atom-set. */
export type StateId = Hash;

/** Stable id for an operation/transition. Synthetic. */
export type OpId = string;

/** Human-friendly name for a precomputed user journey. Becomes a CLI subcommand. */
export type ProcessName = string;

/** Synthetic id for a Leiden community. */
export type ClusterId = string;

/** ISO 8601 timestamp string. */
export type ISO8601 = string;

// ---------------------------------------------------------------------------
// Atom — the smallest interactable affordance on a page.
// (Inspired by GitNexus's "Symbol" — function/class/method.)
// ---------------------------------------------------------------------------

/** A single interactable affordance: button, link, input, etc. */
export interface Atom {
  /** ARIA role: "button" | "link" | "textbox" | "combobox" | etc. */
  role: string;
  /** What a screen reader would announce. Trim whitespace, lowercase. */
  accessible_name: string;
  /** Stable attributes only. id, data-*, aria-label, name. NEVER class names. */
  attrs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// State — a logical screen.
// (Inspired by GitNexus's "File" or "Function" node — a unit of structure.)
// ---------------------------------------------------------------------------

export type StateKind =
  | 'page'    // a full page (URL changes)
  | 'modal'   // dialog overlaid on top of a page
  | 'panel'   // side panel / drawer
  | 'list'    // scrollable list/feed
  | 'form'    // form/wizard step
  | 'error';  // error/empty state

/** A logical state of the site (Inbox, Compose, Profile, ...). */
export interface State {
  /** Hash of canonicalized atom-set. Two visits to the "same" page → same id. */
  id: StateId;
  kind: StateKind;
  /** Human-readable label, derived from accessible-name + URL. */
  label: string;
  /** Canonical, sorted atom-set used for the hash. */
  atoms: Atom[];
  /** "instagram.com/<user>/" if URL has a detected pattern. */
  url_template?: string;
  /** Assigned by Leiden during the CLUSTER phase. */
  cluster_id?: ClusterId;
  /** Confidence we recognize this state correctly. */
  confidence: number; // 0..1
  last_seen: ISO8601;
  last_validated?: ISO8601;
  screenshot_path?: string;
}

// ---------------------------------------------------------------------------
// Operation — a transition (edge).
// (Inspired by GitNexus's CALLS edge — a relationship between symbols.)
// ---------------------------------------------------------------------------

export type OpType =
  | 'click'
  | 'fill'
  | 'submit'
  | 'navigate'
  | 'hover'
  | 'scroll';

export type ConfidenceReason =
  | 'dom-direct'              // resolved directly from accessibility tree
  | 'llm-inferred-validated'  // LLM proposed it, executed successfully
  | 'llm-inferred-untested'   // LLM proposed it, not yet executed
  | 'self-healed';            // updated after a drift event

/** Argument schema for an operation (e.g. fill input takes a string). */
export interface ArgSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file';
  required: boolean;
  description?: string;
}

/** A transition: executing op_type at selector_xpath moves from from_state → to_state. */
export interface Operation {
  id: OpId;
  from_state: StateId;
  to_state: StateId;
  op_type: OpType;
  /** Stagehand-resolved absolute XPath, e.g. "/html/body/div[2]/button". */
  selector_xpath: string;
  /** Natural-language fallback prompt for LLM if selector breaks. */
  instruction: string;
  args_schema: ArgSpec[];
  confidence: number; // 0..1
  reason: ConfidenceReason;
  success_count: number;
  failure_count: number;
  last_success_at?: ISO8601;
  /** Hash of expected to_state.atoms. Used for drift detection (DOM ETag). */
  validation_hash: Hash;
}

// ---------------------------------------------------------------------------
// Process — a named user journey.
// (Inspired by GitNexus's "Process" node — execution flow from entry point.)
// ---------------------------------------------------------------------------

/** A named, BFS-precomputed user journey. Each becomes a CLI subcommand. */
export interface Process {
  name: ProcessName;
  description: string;
  /** Ordered list of operation ids forming the path. */
  steps: OpId[];
  /** Union of arg schemas from all steps. */
  args: ArgSpec[];
  success_rate: number; // 0..1
  last_validated?: ISO8601;
}

// ---------------------------------------------------------------------------
// Cluster — a Leiden community.
// (Inspired by GitNexus's "Community" — densely-connected functional area.)
// ---------------------------------------------------------------------------

/** Leiden community of densely-connected states (e.g. messaging, post-creation). */
export interface Cluster {
  id: ClusterId;
  /** Heuristic name, e.g. "messaging", "post-creation". */
  label: string;
  state_ids: StateId[];
  cohesion: number; // 0..1
}

// ---------------------------------------------------------------------------
// SiteGraph — the full site model. One per domain.
// (Inspired by GitNexus's per-repo graph stored in `.gitnexus/lbug/`.)
// ---------------------------------------------------------------------------

/** Metadata about a site graph's freshness and health. */
export interface SiteGraphMeta {
  last_indexed: ISO8601;
  last_validated?: ISO8601;
  /** Fraction of edges that hit drift in recent runs. */
  drift_score: number;
  states_count: number;
  edges_count: number;
}

/** The full site model. Persisted as JSON, one per domain. */
export interface SiteGraph {
  schema_version: number; // currently 1
  domain: Domain;
  states: Record<StateId, State>;
  edges: Operation[];
  processes: Record<ProcessName, Process>;
  clusters: Record<ClusterId, Cluster>;
  meta: SiteGraphMeta;
}

// ---------------------------------------------------------------------------
// Registry — global index of all sites the user has indexed.
// (Inspired by GitNexus's `~/.gitnexus/registry.json`.)
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  domain: Domain;
  storage_path: string; // absolute path to the site's directory
  indexed_at: ISO8601;
  last_validated?: ISO8601;
  stats: {
    states: number;
    edges: number;
    processes: number;
  };
}

export interface Registry {
  schema_version: number; // currently 1
  entries: Record<Domain, RegistryEntry>;
}

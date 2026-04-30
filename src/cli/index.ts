#!/usr/bin/env node
/**
 * @module cli
 *
 * User-facing entry point. Just wires Commander to the other modules.
 *
 * Subcommands:
 *   siteforge teach <url>            — run the explore loop on a site
 *   siteforge run <domain> <process> — execute a named process
 *   siteforge mcp <domain>           — start an MCP server for a site
 *   siteforge validate <domain>      — drift check
 *   siteforge ls                     — list indexed sites (reads registry)
 *
 * GitNexus parallel: `gitnexus analyze`, `gitnexus serve`, `gitnexus list`.
 */

// IMPLEMENTATION DEFERRED — wires Commander to ../explorer, ../runtime,
// ../emitters, ../storage. Will land in v0.0.4.

console.log('siteforge — early scaffold. CLI not yet implemented.');
console.log('See https://github.com/varadfromeast/siteforge for status.');

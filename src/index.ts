/**
 * siteforge — public library entry point.
 *
 * Most users use the CLI (`siteforge teach`, `siteforge run`).
 * For programmatic use, import from sub-modules:
 *
 *   import { explore }       from 'siteforge/explorer';
 *   import { runProcess }    from 'siteforge/runtime';
 *   import { startMcpServer } from 'siteforge/emitters';
 *   import type { SiteGraph, State, Operation } from 'siteforge/core';
 */

export * as core from './core/index.js';
export * as storage from './storage/index.js';
export * as snapshot from './snapshot/index.js';
export * as explorer from './explorer/index.js';
export * as runtime from './runtime/index.js';
export * as emitters from './emitters/index.js';

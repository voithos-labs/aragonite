/**
 * Seam-side glue between the pure predicates and the `assertInvariant` channel.
 * Callers at commit/bootstrap seams invoke these; the predicates themselves stay
 * pure and unaware of the channel.
 */

import type { CstNode } from '../core/nodes';
import { assertInvariant } from './assert';
import { checkRegistryCompleteness, checkIsContainerIffRebuildRaw } from './registry';
import { checkStaleRaw, checkCategoryFields } from './node-shape';
import { checkContentRange } from './descriptor';

/**
 * Per-commit check for the nodes a commit touched (scoped — never a whole-tree
 * walk). Each predicate self-filters by kind: stale-raw only inspects strip
 * containers, content-range only prose. Run AFTER the commit's rebuildRaw so a
 * strip container's raw is its freshly-rebuilt output.
 */
export function assertCommittedNodes(nodes: CstNode[]): void {
	for (const node of nodes) {
		assertInvariant('stale-raw', () => checkStaleRaw(node));
		assertInvariant('category-fields', () => checkCategoryFields(node));
		assertInvariant('content-range', () => checkContentRange(node));
	}
}

let didStartupCheck = false;

/** Registry-wide checks, run once after built-in registration + container-raw augmentation. */
export function runStartupInvariantChecks(): void {
	if (didStartupCheck) return;
	didStartupCheck = true;
	assertInvariant('registry-completeness', checkRegistryCompleteness);
	assertInvariant('container-rebuild-pairing', checkIsContainerIffRebuildRaw);
}

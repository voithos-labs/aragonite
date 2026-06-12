/**
 * Seam-side glue between the pure predicates and the `assertInvariant` channel.
 * Callers at commit/bootstrap seams invoke these; the predicates themselves stay
 * pure and unaware of the channel.
 */

import type { CstNode } from '../core/nodes';
import { assertInvariant } from './assert';
import {
	checkRegistryCompleteness,
	checkIsContainerIffRebuildRaw,
	checkOpenerRegistry
} from './registry';
import { checkStaleRaw, checkCategoryFields } from './node-shape';
import { checkContentRange } from './descriptor';
import { checkSnapshotIntegrity, type SnapshotEntry } from './sharing';

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

/**
 * G1.9 per-commit seam: the freshest undo entry is the one the commit's
 * mutations could have corrupted, so its digest is re-verified after each
 * commit (one digest over top-level rows). Deeper entries stay covered by
 * the restore-time check in editor-actions/history.ts.
 */
export function assertUndoTopIntegrity(entry: SnapshotEntry | undefined): void {
	if (!entry) return;
	assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
}

let didStartupCheck = false;

/** Registry-wide checks, run once after built-in registration + container-raw augmentation. */
export function runStartupInvariantChecks(): void {
	if (didStartupCheck) return;
	didStartupCheck = true;
	assertInvariant('registry-completeness', checkRegistryCompleteness);
	assertInvariant('container-rebuild-pairing', checkIsContainerIffRebuildRaw);
	assertInvariant('opener-registry', checkOpenerRegistry);
}

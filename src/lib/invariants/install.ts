/**
 * Seam-side glue between the pure predicates and the `assertInvariant` channel, so the
 * predicates themselves stay pure and unaware of it.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocPath } from '../selection/path-math';
import { assertInvariant } from './assert';
import { checkCommitPathAddressable } from './commit-paths';
import {
	flushPendingRegistrationChecks,
	checkInlineConstructPoliciesAtMount
} from '../schema/registration-checks';
import {
	checkStaleRaw,
	checkOpaqueStaleRaw,
	checkOpaqueRebuildDeterminism,
	checkReservedChromeSlot,
	checkCategoryFields
} from './node-shape';
import { checkContentRange } from './descriptor';
import { checkIdsChildrenLockstep } from './structural-descriptor';
import { checkSnapshotIntegrity, type SnapshotEntry } from './snapshot-integrity';

/**
 * Per-commit check for the nodes a commit touched, never a whole-tree walk. Each predicate
 * self-filters by kind. Run AFTER the commit's rebuildRaw, so a strip container's raw is
 * its freshly-rebuilt output.
 */
export function assertCommittedNodes(nodes: CstNode[]): void {
	for (const node of nodes) {
		assertInvariant('stale-raw', () => checkStaleRaw(node));
		assertInvariant('opaque-stale-raw', () => checkOpaqueStaleRaw(node));
		assertInvariant('opaque-rebuild-determinism', () => checkOpaqueRebuildDeterminism(node));
		assertInvariant('reserved-chrome-slot', () => checkReservedChromeSlot(node));
		assertInvariant('category-fields', () => checkCategoryFields(node));
		assertInvariant('content-range', () => checkContentRange(node));
	}
}

/**
 * Pre-mutate commit-seam check that both declared coordinates are doc-absolute (G1.16,
 * `commit-paths.ts`). Null skips a coordinate the commit doesn't carry.
 */
export function assertCommitPaths(
	doc: Document,
	snapshotPath: DocPath | null,
	eventPath: DocPath | null
): void {
	if (snapshotPath) {
		assertInvariant('commit-path-dialect', () =>
			checkCommitPathAddressable(doc, snapshotPath, 'snapshot.path')
		);
	}
	if (eventPath) {
		assertInvariant('commit-path-dialect', () =>
			checkCommitPathAddressable(doc, eventPath, 'eventPath')
		);
	}
}

/**
 * G1.9 per-commit seam: the freshest undo entry is the one this commit's mutations could
 * have corrupted, so only its digest is re-verified. Deeper entries stay covered by the
 * restore-time check in `editor-actions/commit/history.ts`.
 */
export function assertUndoTopIntegrity(entry: SnapshotEntry | undefined): void {
	if (!entry) return;
	assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
}

/**
 * G1.36 consumer half, at each publish seam: the descriptor's own bounds check cannot see a
 * change that fits its array while describing the wrong window, and a short id array reaches
 * Svelte's keyed each as missing keys.
 */
export function assertIdsInLockstep(seam: string, idCount: number, childCount: number): void {
	assertInvariant('ids-children-lockstep', () =>
		checkIdsChildrenLockstep(seam, idCount, childCount)
	);
}

/**
 * Registry-wide checks at the mount seam. The flush owns the once-latch: the first sweeps
 * the whole world, later mounts validate only registrations since the previous flush. The
 * inline-policy check sits outside it — mount-only, and table-wide on every mount (G1.31).
 */
export function runStartupInvariantChecks(): void {
	flushPendingRegistrationChecks();
	checkInlineConstructPoliciesAtMount();
}

/**
 * Seam-side glue between the pure predicates and the `assertInvariant` channel.
 * Callers at commit/bootstrap seams invoke these; the predicates themselves stay
 * pure and unaware of the channel.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocPath } from '../selection/path-math';
import { assertInvariant } from './assert';
import { checkCommitPathAddressable } from './commit-paths';
import { flushPendingRegistrationChecks } from '../schema/registration-checks';
import {
	checkStaleRaw,
	checkOpaqueStaleRaw,
	checkOpaqueRebuildDeterminism,
	checkReservedChromeSlot,
	checkCategoryFields
} from './node-shape';
import { checkContentRange } from './descriptor';
import { checkSnapshotIntegrity, type SnapshotEntry } from './snapshot-integrity';

/**
 * Per-commit check for the nodes a commit touched (scoped — never a whole-tree
 * walk). Each predicate self-filters by kind: stale-raw only inspects strip
 * containers, content-range only prose. Run AFTER the commit's rebuildRaw so a
 * strip container's raw is its freshly-rebuilt output.
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
 * Pre-mutate commit-seam check: both declared commit coordinates must be
 * doc-absolute (see invariants/commit-paths.ts). Null skips a coordinate the
 * commit doesn't carry ('skip' snapshot, op-less commit).
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
 * G1.9 per-commit seam: the freshest undo entry is the one the commit's
 * mutations could have corrupted, so its digest is re-verified after each
 * commit (one digest over top-level rows). Deeper entries stay covered by
 * the restore-time check in editor-actions/commit/history.ts.
 */
export function assertUndoTopIntegrity(entry: SnapshotEntry | undefined): void {
	if (!entry) return;
	assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
}

/**
 * Registry-wide checks at the mount seam. The registration-check flush owns
 * the once-latch: the first flush sweeps the whole world; later mounts
 * validate only registrations that arrived since the previous flush.
 */
export function runStartupInvariantChecks(): void {
	flushPendingRegistrationChecks();
}

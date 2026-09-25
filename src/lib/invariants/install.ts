/**
 * Wires the pure predicates to `assertInvariant`, so the predicates stay pure and know nothing
 * about how a violation is reported.
 */

import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import type { DocPath } from '../selection/path-math';
import { assertInvariant } from '../assert';
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
import { checkChildIdParity } from './child-id-parity';
import { checkChildSpansLockstep, checkIdsChildrenLockstep } from './structural-descriptor';
import { checkSnapshotIntegrity, type SnapshotEntry } from './snapshot-integrity';

/**
 * Checks only the nodes a commit touched, never the whole tree. Each predicate filters by kind
 * itself. Call it after the commit's `rebuildRaw`, so a strip container's raw is the output
 * that rebuild just produced. The reparses read the editor's grammar, so syntax the editor left
 * out cannot make a node look stale.
 */
export function assertCommittedNodes(nodes: CstNode[], grammar: GrammarView): void {
	for (const node of nodes) {
		assertInvariant('stale-raw', () => checkStaleRaw(node, grammar));
		assertInvariant('opaque-stale-raw', () => checkOpaqueStaleRaw(node, grammar));
		assertInvariant('opaque-rebuild-determinism', () => checkOpaqueRebuildDeterminism(node));
		assertInvariant('reserved-chrome-slot', () => checkReservedChromeSlot(node));
		assertInvariant('category-fields', () => checkCategoryFields(node));
		assertInvariant('content-range', () => checkContentRange(node));
		assertInvariant('child-spans-lockstep', () => checkChildSpansLockstep(node));
		assertInvariant('child-id-parity', () => checkChildIdParity(node));
	}
}

/**
 * Checks, before the commit mutates anything, that both declared paths are document-absolute
 * (G1.16, `commit-paths.ts`). Null skips a path this commit does not carry.
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
 * G1.9, once per commit: only the newest undo entry could have been corrupted by this commit's
 * mutations, so only its digest is re-checked. Older entries are covered when they are
 * restored, in `editor-actions/commit/history.ts`.
 */
export function assertUndoTopIntegrity(entry: SnapshotEntry | undefined): void {
	if (!entry) return;
	assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
}

/**
 * G1.36, the reading half, run wherever ids are written to state: the descriptor's own bounds
 * check cannot catch a change that fits its array but describes the wrong range, and an id
 * array that is too short reaches Svelte's keyed each as missing keys.
 */
export function assertIdsInLockstep(seam: string, idCount: number, childCount: number): void {
	assertInvariant('ids-children-lockstep', () =>
		checkIdsChildrenLockstep(seam, idCount, childCount)
	);
}

/**
 * The registry-wide checks, run when the editor mounts. The flush runs the full sweep the first
 * time and only the registrations added since the previous flush after that. The inline-policy
 * check sits outside that latch: it runs on every mount, over the whole table (G1.31).
 */
export function runStartupInvariantChecks(): void {
	flushPendingRegistrationChecks();
	checkInlineConstructPoliciesAtMount();
}

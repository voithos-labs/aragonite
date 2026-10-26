/**
 * Wires the pure predicates to `assertInvariant`, so the predicates stay pure and know nothing
 * about how a violation is reported.
 */

import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import type { DocPath } from '../selection/path-math';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
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
	checkCategoryFields,
	checkTaskMarkerSlot
} from './node-shape';
import { checkContentRange } from './descriptor';
import { checkChildIdParity } from './child-id-parity';
import { checkChildSpansLockstep, checkIdsChildrenLockstep } from './structural-descriptor';
import { checkSnapshotIntegrity, type SnapshotEntry } from './snapshot-integrity';
import { checkLastLineKept } from './open-tail';
import { checkKeepsABlock } from './keeps-a-block';
import { checkReadsBack, READ_BACK_LIMIT } from './reads-back';
import { checkListMarkerWidths } from './list-marker-widths';
import { perfEnabled } from '../perf/instruments';
import { checkTopLevelUntouched } from './top-level-untouched';
import { checkLineEndingPairsKept, type LineEndingCounts } from './line-ending-pairs';
import { lineEndingCounts } from '../core/line-ending-pairs';
import { concatChildren } from '../core/serializer';
import { checkWrittenUnshared } from './written-unshared';
import type { SharingState } from '../tree-operations/sharing';

/** Checks only the nodes a commit touched. Call it after the commit's `rebuildRaw`, so a strip
 *  container's raw is that rebuild's output. */
export function assertCommittedNodes(nodes: CstNode[], grammar: GrammarView): void {
	// Off under the perf instruments, as G1.55 is: the stale-raw check re-reads each container.
	if (perfEnabled()) return;
	for (const node of nodes) {
		assertInvariant('stale-raw', () => checkStaleRaw(node, grammar));
		assertInvariant('opaque-stale-raw', () => checkOpaqueStaleRaw(node, grammar));
		assertInvariant('opaque-rebuild-determinism', () => checkOpaqueRebuildDeterminism(node));
		assertInvariant('reserved-chrome-slot', () => checkReservedChromeSlot(node));
		assertInvariant('category-fields', () => checkCategoryFields(node));
		assertInvariant('content-range', () => checkContentRange(node));
		assertInvariant('child-spans-lockstep', () => checkChildSpansLockstep(node));
		assertInvariant('child-id-parity', () => checkChildIdParity(node));
		assertInvariant('task-marker-slot', () => checkTaskMarkerSlot(node, grammar));
	}
}

/** Checks, before the commit mutates anything, that both declared paths are document-absolute
 *  (G1.16); null skips a path the commit does not carry. */
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

/** G1.9, once per commit: only the newest undo entry can have been corrupted by this commit, so
 *  only its digest is re-checked; older entries are checked when they are restored. */
export function assertUndoTopIntegrity(entry: SnapshotEntry | undefined): void {
	if (!entry) return;
	assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
}

/** G1.117 for a commit, after its mutation: `before` is {@link documentLineEndings} read before
 *  it, null when the checks are off. */
export function assertLineEndingPairsKept(doc: Document, before: LineEndingCounts | null): void {
	if (!before) return;
	assertInvariant('line-ending-pairs', () =>
		checkLineEndingPairsKept(before, documentLineEndings(doc)!)
	);
}

/** G1.117 for a keystroke written in place: the leaf's bytes before and after. */
export function assertLeafLineEndingPairsKept(before: string, after: string): void {
	assertInvariant('line-ending-pairs', () =>
		checkLineEndingPairsKept(lineEndingCounts(before), lineEndingCounts(after))
	);
}

/** G1.151 for a keystroke written in place: the nodes it wrote. */
export function assertWrittenUnshared(written: readonly CstNode[], sharing: SharingState): void {
	assertInvariant('written-unshared', () =>
		checkWrittenUnshared(written, (node) => sharing.isShared(node))
	);
}

/** The document's line-ending counts for G1.117; null outside dev and under the perf instruments,
 *  since it reads the whole document. */
export function documentLineEndings(doc: Document): LineEndingCounts | null {
	if (!devChecksOn || perfEnabled()) return null;
	return lineEndingCounts(doc.prefix + concatChildren(doc.children) + doc.suffix);
}

/** G1.41, after every structural commit publishes: `wasOpen` is `endsOpen` read before it mutated. */
export function assertLastLineKept(doc: Document, wasOpen: boolean): void {
	assertInvariant('last-line-kept', () => checkLastLineKept(doc, wasOpen));
}

/** G1.55, after a keystroke's or a commit's rebuild: each top-level block in `tops`, the ones now
 *  holding what the edit wrote, reads back as itself. Off under the perf instruments. */
export function assertReadsBack(tops: readonly CstNode[], grammar: GrammarView): void {
	if (!devChecksOn || perfEnabled()) return;
	for (const top of tops) assertInvariant('reads-back', () => checkReadsBack(top, grammar));
}

/** G1.118, at the same moments as G1.55 and under the same size limit: each list in `tops` keeps
 *  the marker-width counts its items give. */
export function assertListMarkerWidths(tops: readonly CstNode[]): void {
	if (!devChecksOn || perfEnabled()) return;
	for (const top of tops) {
		if (top.raw.length > READ_BACK_LIMIT) continue;
		assertInvariant('list-marker-widths', () => checkListMarkerWidths(top));
	}
}

/** G1.44, after every structural commit publishes: `touched` is what the commit wrote. */
export function assertKeepsABlock(doc: Document, touched: CstNode[]): void {
	assertInvariant('keeps-a-block', () => checkKeepsABlock(doc, touched));
}

/** G1.54, when a commit's mutation returns: `tree` is the top-level array the commit started from,
 *  `before` its blocks once the scopes were prepared. */
export function assertTopLevelUntouched(
	live: readonly CstNode[],
	tree: readonly CstNode[],
	before: readonly CstNode[]
): void {
	assertInvariant('top-level-untouched', () => checkTopLevelUntouched(live, tree, before));
}

/** G1.36, the reading half, run wherever ids are written to state: an id array that is too short
 *  reaches Svelte's keyed each as missing keys. */
export function assertIdsInLockstep(seam: string, idCount: number, childCount: number): void {
	assertInvariant('ids-children-lockstep', () =>
		checkIdsChildrenLockstep(seam, idCount, childCount)
	);
}

/** The registry-wide checks, run on mount: the full sweep the first time, then only the
 *  registrations added since. The inline-policy check runs on every mount (G1.31). */
export function runStartupInvariantChecks(): void {
	flushPendingRegistrationChecks();
	checkInlineConstructPoliciesAtMount();
}

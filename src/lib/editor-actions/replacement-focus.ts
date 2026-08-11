/**
 * Shared helpers for `updateBlockContent`'s structural arm: the pre-commit reparse
 * probe that picks structural-vs-typing, and the post-commit caret restore.
 */

import { updateNodeContent, focusTargetInReplacement } from '../tree-operations';
import { makeBlockNode, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import { readBlockPath } from '../selection/path-lookup';
import type { CommitScope } from './block-edit-scope';

// ── Reparse probe ────────────────────────────────────────────────────────────

/**
 * Preview the content update on a throwaway single-node probe to pick between the
 * structural commit and the routine typing path. The live tree is untouched — the
 * chosen branch runs the real mutation. `tailSuffix` is the document's folded trailing
 * line when `node` is the tail block, else `''`: blanking the tail materializes it
 * (GH #129), which is structural and must route into the ceremony.
 */
export function previewContentReparse(
	node: NodeView,
	text: string,
	grammar: Parameters<typeof updateNodeContent>[3],
	ownerKind: AnyBlockKind | undefined,
	tailSuffix: string
): StructuralChange {
	const probe = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	});
	// The owner KIND rides along or the probe answers about different bytes than the commit
	// writes; the owner node stays out — a probe must not write real wrap slots. The suffix
	// rides by VALUE for the same reason: the probe's settle may only spend the copy.
	return updateNodeContent(
		{ children: [probe], ownerKind, owner: undefined, suffix: tailSuffix },
		0,
		text,
		grammar
	);
}

// ── Post-replacement focus ───────────────────────────────────────────────────

/**
 * Restore the caret after a structural content commit; a multi-block replacement
 * descends to the offset's home block. A no-op when focus already moved on.
 */
export function focusAfterContentReplace(
	scopePath: number[],
	at: number,
	change: StructuralChange,
	focusOffset: number,
	scope: CommitScope
): void {
	const count = change.op === 'replace' ? change.newCount : 1;
	if (focusMovedOutsideReplacement(scopePath, at, count)) return;
	if (change.op === 'replace' && change.newCount > 1) {
		const blocks = scope.children().slice(change.at, change.at + change.newCount);
		const target = focusTargetInReplacement(blocks, focusOffset);
		scope.refAt(change.at + target.index)?.focus(target.offset);
		return;
	}
	scope.refAt(at)?.focus(focusOffset);
}

/**
 * A typing commit needs the caret restored; a BLUR commit (source folding as focus
 * lands elsewhere) must not yank it back. The discriminator is where focus lives at
 * afterTick time — a `data-block-path` outside the replaced window means it moved on.
 */
export function focusMovedOutsideReplacement(
	scopePath: number[],
	at: number,
	count: number
): boolean {
	if (typeof document === 'undefined') return false;
	const host = document.activeElement?.closest?.('[data-block-path]') ?? null;
	// No locatable path reads as "a remount ate the focused el", so run the restore.
	const path = readBlockPath(host);
	if (!path) return false;
	for (let depth = 0; depth < scopePath.length; depth++) {
		if (path[depth] !== scopePath[depth]) return true;
	}
	const index = path[scopePath.length];
	return index === undefined || index < at || index >= at + count;
}

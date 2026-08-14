/**
 * Shared helpers for `updateBlockContent`'s structural arm: the pre-commit reparse
 * probe that picks structural-vs-typing, and the post-commit caret restore.
 */

import { updateNodeContent } from '../tree-operations';
import { settledCaretTarget, type SettledContent } from '../tree-operations/node-ops';
import { makeBlockNode, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import { readBlockPath } from '../selection/path-lookup';
import type { CommitScope } from './block-edit-scope';

// ── Reparse probe ────────────────────────────────────────────────────────────

/**
 * Preview the content update on a throwaway single-node probe to pick between the structural
 * commit and the routine typing path; the live tree is untouched. `tailSuffix` is the document's
 * folded trailing line when `node` is the tail block, else `''`: blanking the tail materializes
 * it, which is structural and must route into the ceremony.
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
	).change;
}

// ── Post-replacement focus ───────────────────────────────────────────────────

/**
 * Restore the caret after a structural content commit. A no-op when focus already moved on.
 */
export function focusAfterContentReplace(
	scopePath: number[],
	at: number,
	settled: SettledContent,
	focusOffset: number,
	scope: CommitScope
): void {
	const { change } = settled;
	const count = change.op === 'replace' ? change.newCount : 1;
	// The settled window, not the slot the gesture named: a fold above moved both.
	const windowAt = change.op === 'replace' ? change.at : at;
	if (focusMovedOutsideReplacement(scopePath, windowAt, count)) return;
	const target = settledCaretTarget(settled, at, focusOffset, scope.children());
	scope.refAt(target.index)?.focus(target.offset);
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

/**
 * Shared helpers for `updateBlockContent`'s structural arm: the pre-commit
 * reparse probe that picks structural-vs-typing, and the post-commit caret
 * restore.
 */

import { updateNodeContent, focusTargetInReplacement } from '../tree-operations';
import { makeBlockNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import { readBlockPath } from '../selection/path-lookup';
import type { CommitScope } from './block-edit-scope';

// ── Reparse probe ────────────────────────────────────────────────────────────

/**
 * Preview the content update on a throwaway single-node probe (kind + trivia +
 * raw are all `updateNodeContent` reads) to pick between the structural commit
 * (kind change or multi-block) and the routine typing path. The live tree is
 * untouched — the chosen branch runs the real mutation.
 */
export function previewContentReparse(
	node: NodeView,
	text: string,
	grammar: Parameters<typeof updateNodeContent>[3]
): StructuralChange {
	const probe = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	});
	return updateNodeContent({ children: [probe] }, 0, text, grammar);
}

// ── Post-replacement focus ───────────────────────────────────────────────────

/**
 * Restore the caret after a structural content commit. Focus stays in the
 * replaced window's first block (identity-preserving multi-block split) or falls
 * to the reparsed slot; a multi-block replacement descends to the offset's home
 * block. A no-op when focus already moved on (`focusMovedOutsideReplacement`).
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
 * A structural content commit restores the caret afterwards, but only when it
 * is servicing a live caret: while TYPING, focus either stays in the replaced
 * window's first block (identity-preserving multi-block split) or falls to
 * <body> when a kind change remounts the focused element — both need the
 * restore. A BLUR commit (render-primary source folding as focus lands in
 * another block) must not yank the caret back to the replacement.
 *
 * The discriminator is where focus lives at afterTick time: inside another
 * block's DOM (`data-block-path` outside the replaced window) means the caret
 * deliberately moved on.
 */
export function focusMovedOutsideReplacement(
	scopePath: number[],
	at: number,
	count: number
): boolean {
	if (typeof document === 'undefined') return false;
	const host = document.activeElement?.closest?.('[data-block-path]') ?? null;
	// No locatable path (no active host, or a plugin's non-JSON value) reads as
	// "fell to body/root — a remount ate the focused el", so run the restore.
	const path = readBlockPath(host);
	if (!path) return false;
	for (let depth = 0; depth < scopePath.length; depth++) {
		if (path[depth] !== scopePath[depth]) return true;
	}
	const index = path[scopePath.length];
	return index === undefined || index < at || index >= at + count;
}

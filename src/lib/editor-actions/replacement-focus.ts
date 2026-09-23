/**
 * Shared by both `updateBlockContent`s: the trial reparse that picks between a structural
 * commit and routine typing, and the caret restore after a structural commit.
 */

import { updateNodeContent } from '../tree-operations';
import { settledCaretTarget, type SettledContent } from '../tree-operations/content-write';
import { makeBlockNode, metadataOf, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import { readBlockPath } from '../selection/path-lookup';
import type { CommitScope } from './block-edit-scope';

// ── Reparse probe ────────────────────────────────────────────────────────────

/**
 * Run the content update on a throwaway copy of the node to pick between the structural
 * commit and the routine typing path; the live tree is untouched. `tailSuffix` is the
 * trailing blank line (kept in its suffix) when `node` is the last block, else `''`: blanking
 * the last block turns that line into a block, which is structural and needs a commit.
 */
export function previewContentReparse(
	node: NodeView,
	text: string,
	grammar: Parameters<typeof updateNodeContent>[3],
	ownerKind: AnyBlockKind | undefined,
	tailSuffix: string,
	taskItem?: NodeView
): StructuralChange {
	const probe = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	});
	// The owner kind goes along, or the trial answers about different bytes than the commit
	// writes; the owner node stays out, since a trial must not write the real container. The
	// suffix goes by value for the same reason: the trial may only consume the copy.
	// `taskItem` is the task item whose paragraph this is: a copy of it makes the trial read the
	// text after the marker as the commit will.
	const owner =
		taskItem &&
		makeBlockNode({
			kind: taskItem.kind,
			leadingTrivia: '',
			raw: taskItem.raw,
			metadata: { ...metadataOf(taskItem, 'listItem') },
			children: [probe]
		});
	return updateNodeContent(
		{ children: [probe], ownerKind, owner, suffix: tailSuffix },
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
	// The index after the fix-up, not the one the edit named: a collapse above moved both.
	const windowAt = change.op === 'replace' ? change.at : at;
	if (focusMovedOutsideReplacement(scopePath, windowAt, count)) return;
	const target = settledCaretTarget(settled, at, focusOffset, scope.children());
	scope.refAt(target.index)?.focus(target.offset);
}

/**
 * A typing commit needs the caret restored; a blur commit (revealed source collapsing as
 * focus lands elsewhere) must not pull it back. The test is where focus is at afterTick
 * time: a `data-block-path` outside the replaced range means it moved on.
 */
export function focusMovedOutsideReplacement(
	scopePath: number[],
	at: number,
	count: number
): boolean {
	if (typeof document === 'undefined') return false;
	const host = document.activeElement?.closest?.('[data-block-path]') ?? null;
	// No readable path means a remount removed the focused element, so run the restore.
	const path = readBlockPath(host);
	if (!path) return false;
	for (let depth = 0; depth < scopePath.length; depth++) {
		if (path[depth] !== scopePath[depth]) return true;
	}
	const index = path[scopePath.length];
	return index === undefined || index < at || index >= at + count;
}

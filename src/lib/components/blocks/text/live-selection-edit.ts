/**
 * What a browser range edit writes in live mode, read off the `beforeinput` event. The range can
 * span delimiter runs the user never saw, which contenteditable would take literally, so the edit
 * goes through `replaceRangeInLeaf` (`docs/design/live-mode.md` § 4.5). Every prose block routes
 * its `beforeinput` through {@link resolveLiveRangeEdit}.
 */

import { imeOwnsInput } from '../../../browser/composition';
import type { NodeView } from '../../../core/node-views';
import type { StoredAs } from '../../../schema/stored-as';
import { replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
import { decidedDelete, isDeleteInput, readInput, targetRange } from '../../../browser/input';

/** The raw-offset lookups a browser range edit needs from the block. */
export interface LiveEditCursor {
	rawRangeOf(range: AbstractRange): { start: number; end: number } | null;
	getRawSelection(): { start: number; end: number } | null;
}

/** Rewrite the block's bytes, or consume the key and write nothing: an input handled here whose
 *  payload cannot be read writes nothing, since the browser would splice the hidden runs. */
export type LiveRangeEdit = LiveRangeRewrite | { kind: 'swallow' };

export interface LiveRangeRewrite {
	kind: 'rewrite';
	range: { start: number; end: number };
	raw: string;
	caret: number;
}

/** What a prose block does with a `beforeinput` in live mode. Null where there is nothing to clean,
 *  so the browser keeps its own edit and its grapheme and IME behavior. */
export function resolveLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	store: StoredAs
): LiveRangeEdit | null {
	if (!store.reading.hidesDelimitersAtCaret() || !rewritesTargetRange(e)) return null;
	// A delete at a caret is the editor's own delete step's, which decides it after this one.
	if (decidedDelete(e) && cursor.getRawSelection() === null) return null;
	// A collapsed insert is the typed-insert decision's, which runs after this step.
	const target = pendingEditRange(e, cursor);
	if (!target || target.start === target.end) return null;
	const insert = replacementText(e);
	const edit = replaceRangeInLeaf(node, target, insert ?? '', store);
	if (edit.matchesBrowserEdit) return null;
	return insert === null
		? { kind: 'swallow' }
		: { kind: 'rewrite', range: edit.range, raw: edit.raw, caret: edit.caret };
}

/** The wrapper every block runs around {@link resolveLiveRangeEdit}, shared so a new precondition
 *  reaches every block. Does nothing while a shown source has outrun the CST. */
export function applyLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	store: StoredAs,
	isRevealing: () => boolean,
	commit: (edit: LiveRangeRewrite) => void
): boolean {
	if (isRevealing()) return false;
	const edit = resolveLiveRangeEdit(e, node, cursor, store);
	if (!edit) return false;
	e.preventDefault();
	if (edit.kind === 'rewrite') commit(edit);
	return true;
}

// ── Reading the event ────────────────────────────────────────────────────────

/** The range a ranged edit will rewrite: the browser's target, since a word delete reports the run
 *  rather than the caret, else the selection; null for a collapsed target, read no further. */
function pendingEditRange(
	e: InputEvent,
	cursor: LiveEditCursor
): { start: number; end: number } | null {
	const target = targetRange(e);
	if (target?.collapsed) return null;
	return target ? cursor.rawRangeOf(target) : cursor.getRawSelection();
}

/** The inputs that rewrite the range they target. Composition is excluded by kind and flag, since
 *  `composition-seat.ts` handles it start to finish and a second write here would double it. */
function rewritesTargetRange(e: InputEvent): boolean {
	const read = readInput(e);
	if (imeOwnsInput(e) || read.kind === 'compose') return false;
	if (read.kind === 'delete') return read.source !== 'ime';
	return read.kind === 'insert' || read.kind === 'replace';
}

/** What an input writes over its range, or null for `dataTransfer` text, which would skip the paste
 *  transforms (G4.11); consuming the key beats turning a replacement into a delete. */
function replacementText(e: InputEvent): string | null {
	return isDeleteInput(e) ? '' : e.data;
}

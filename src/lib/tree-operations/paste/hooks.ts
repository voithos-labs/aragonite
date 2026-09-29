/**
 * Default paste hooks for kinds with no bespoke PasteSurface, registered at module load
 * for every built-in kind whose descriptor advertises `supportsInline`.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding, type LineEnding } from '../../core/lines';
import { buildPastedReplacement } from './paste-replacement';
import type { ChildSlot } from '../list/task-paragraph';
import { replaceRangeInLeaf, type LeafRangeEdit } from '../leaf-range';
import { getContentRange, readInline } from '../../core/inline';
import { CONTENT_VISIBILITY, visibleRuns } from '../../core/inline/visibility';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '../../schema/block-kind-descriptor';
import {
	registerPasteSurface,
	type PasteRange,
	type InlinePasteResult,
	type StructuralPasteResult
} from '../paste-surfaces';
import type { StoredAs } from '../../schema/stored-as';

// Registered by their own component instead of the loop below. One registrar per kind, so
// correctness doesn't hinge on module load order.
const BESPOKE_SURFACE_KINDS = new Set<BlockKind>(['tableCell']);

/** The pasted text over the selection, or at the caret, written as typing it there would be. */
export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete: PasteRange | undefined,
	store: StoredAs,
	lineEnding: LineEnding
): InlinePasteResult {
	const range = preDelete ?? { start: offset, end: offset };
	const bare = dropClosingLineEnding(text);
	const probe = replaceRangeInLeaf(node, range, bare, store);
	const edit =
		bare === text || endsVisibleLine(node, probe, store)
			? probe
			: replaceRangeInLeaf(node, range, text, store);
	return {
		newRaw: trimTrailingLineEnding(edit.raw) + trailingLineEnding(node.raw, lineEnding),
		caretOffset: edit.caret
	};
}

/**
 * `text` without the ending of its last line, which against a line end would leave a blank line
 * in the paragraph; a whole blank last line stays, since the clipboard carried it as a block.
 */
function dropClosingLineEnding(text: string): string {
	const closing = /\r?\n$/.exec(text);
	if (!closing) return text;
	const rest = text.slice(0, closing.index);
	return rest === '' || /\r?\n$/.test(rest) ? text : rest;
}

/** Whether nothing the reader sees follows the caret on its line: a delimiter run the reading
 *  hides there, such as a bold word's closer, still ends the line. */
function endsVisibleLine(node: CstNode, edit: LeafRangeEdit, store: StoredAs): boolean {
	const after = trimTrailingLineEnding(edit.raw).slice(edit.caret);
	if (after === '' || /^\r?\n/.test(after)) return true;
	if (!store.reading.hidesDelimitersAtCaret()) return false;
	const lineEnd = edit.caret + (/\r?\n/.exec(after)?.index ?? after.length);
	const content = getContentRange({ ...node, raw: edit.raw });
	const { resolver, grammar } = store.reading;
	const inlines = readInline(edit.raw, content.start, content.end, resolver, grammar);
	return !visibleRuns(inlines, edit.raw, CONTENT_VISIBILITY, { grammar }).some(
		(run) => run.visible && run.text !== '' && run.end > edit.caret && run.start < lineEnd
	);
}

export function defaultStructuralHook(
	node: CstNode,
	offset: number,
	blocks: CstNode[],
	preDelete: PasteRange | undefined,
	store: StoredAs,
	lineEnding: LineEnding,
	slot: ChildSlot
): StructuralPasteResult {
	// The blocks go in after the cut, as a split does, so the cut takes no text of its own.
	const cut = preDelete && replaceRangeInLeaf(node, preDelete, '', store);
	const display = cut && trimTrailingLineEnding(cut.raw);
	// Compare the bytes rather than the range: a cleanup can drop more than the selection did,
	// and an empty range leaves them equal, which is exactly when the original node stands.
	const synthLeaf =
		!cut || display === trimTrailingLineEnding(node.raw)
			? node
			: { ...node, raw: display + trailingLineEnding(node.raw, lineEnding) };

	const { nodes, lastPastedIndex } = buildPastedReplacement(
		synthLeaf,
		cut ? cut.caret : offset,
		blocks,
		lineEnding,
		store.reading.grammar,
		slot
	);
	// The caret lands where the pasted bytes end, which the fix-up tracks when it merges the
	// residue into the last pasted block.
	return { replacement: nodes, focusReplacementIndex: lastPastedIndex, focusOffset: CURSOR_END };
}

// Built-in kinds are all registered by the time this top level runs; a plugin kind
// registering later must register its own paste surface.
for (const kind of getAllRegisteredKinds()) {
	if (!isBuiltinBlockKind(kind)) continue;
	if (BESPOKE_SURFACE_KINDS.has(kind)) continue;
	if (tryGetBlockKindDescriptor(kind)?.supportsInline) {
		registerPasteSurface({
			kind,
			onInlinePaste: defaultInlineHook,
			onStructuralPaste: defaultStructuralHook
		});
	}
}

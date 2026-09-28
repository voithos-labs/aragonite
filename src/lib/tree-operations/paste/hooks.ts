/**
 * Default paste hooks for kinds with no bespoke PasteSurface, registered at module load
 * for every built-in kind whose descriptor advertises `supportsInline`.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding, type LineEnding } from '../../core/lines';
import { buildPastedReplacement } from './paste-replacement';
import type { FragmentReader } from '../list/task-paragraph';
import { cutRangeFromDisplay } from '../node-ops';
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
import type { Reading } from '../../schema/reading';

// Registered by their own component instead of the loop below. One registrar per kind, so
// correctness doesn't hinge on module load order.
const BESPOKE_SURFACE_KINDS = new Set<BlockKind>(['tableCell']);

/**
 * The leaf's bytes and caret after the paste's delete half, through the join cleanup, so a
 * stranded delimiter run the user never saw is dropped (`docs/design/live-mode.md` § 4.5).
 */
function applyPreDelete(
	node: CstNode,
	display: string,
	preDelete: PasteRange | undefined,
	offset: number,
	reading: Reading
): { display: string; offset: number } {
	if (!preDelete) return { display, offset };
	return cutRangeFromDisplay(node, display, preDelete, reading);
}

export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete: PasteRange | undefined,
	reading: Reading,
	lineEnding: LineEnding
): InlinePasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const closing = trailingLineEnding(node.raw, lineEnding);

	const { display: effectiveDisplay, offset: effectiveOffset } = applyPreDelete(
		node,
		display,
		preDelete,
		offset,
		reading
	);

	const after = effectiveDisplay.slice(effectiveOffset);
	const inserted = atLineEnd(after) ? dropClosingLineEnding(text) : text;
	const newDisplay = effectiveDisplay.slice(0, effectiveOffset) + inserted + after;

	return {
		newRaw: newDisplay + closing,
		caretOffset: effectiveOffset + inserted.length
	};
}

const atLineEnd = (after: string): boolean => after === '' || /^\r?\n/.test(after);

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

export function defaultStructuralHook(
	node: CstNode,
	offset: number,
	blocks: CstNode[],
	preDelete: PasteRange | undefined,
	reading: Reading,
	lineEnding: LineEnding,
	readSlot: FragmentReader
): StructuralPasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const cut = applyPreDelete(node, display, preDelete, offset, reading);
	// Compare the bytes rather than the range: a cleanup can drop more than the selection did,
	// and an empty range leaves them equal, which is exactly when the original node stands.
	const synthLeaf =
		cut.display === display
			? node
			: { ...node, raw: cut.display + trailingLineEnding(node.raw, lineEnding) };

	const { nodes, lastPastedIndex } = buildPastedReplacement(
		synthLeaf,
		cut.offset,
		blocks,
		lineEnding,
		reading.grammar,
		readSlot
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

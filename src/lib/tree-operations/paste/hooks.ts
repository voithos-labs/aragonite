/**
 * Default paste hooks for kinds with no bespoke PasteSurface, registered at module load
 * for every built-in kind whose descriptor advertises `supportsInline`.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { buildPastedReplacement } from './paste-replacement';
import { cutRangeFromDisplay } from '../node-ops';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '../../schema/block-kind-descriptor';
import {
	registerPasteSurface,
	type PasteSurface,
	type PasteRange,
	type PasteSeam,
	type InlinePasteResult,
	type StructuralPasteResult
} from '../paste-surfaces';

// Registered by their own component instead of the loop below. One registrar per kind, so
// correctness doesn't hinge on module load order.
const BESPOKE_SURFACE_KINDS = new Set<BlockKind>(['tableCell']);

/**
 * The leaf's bytes and caret after the paste's delete half, through the one join cleanup, so a
 * cut that stranded a delimiter run the user never saw drops it here rather than pasting it
 * into view (live-mode.md § 4.5). The range is forwarded whole: the endpoints are the cleanup's
 * to read.
 */
function applyPreDelete(
	node: CstNode,
	display: string,
	preDelete: PasteRange | undefined,
	offset: number,
	seam: PasteSeam | undefined
): { display: string; offset: number } {
	if (!preDelete) return { display, offset };
	return cutRangeFromDisplay(node, display, preDelete, seam?.presentationMode, seam?.linkRef);
}

export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange,
	seam?: PasteSeam
): InlinePasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const lineEnding = trailingLineEnding(node.raw);

	const { display: effectiveDisplay, offset: effectiveOffset } = applyPreDelete(
		node,
		display,
		preDelete,
		offset,
		seam
	);

	const after = effectiveDisplay.slice(effectiveOffset);
	const inserted = atLineEnd(after) ? dropClosingLineEnding(text) : text;
	const newDisplay = effectiveDisplay.slice(0, effectiveOffset) + inserted + after;

	return {
		newRaw: newDisplay + lineEnding,
		caretOffset: effectiveOffset + inserted.length
	};
}

const atLineEnd = (after: string): boolean => after === '' || /^\r?\n/.test(after);

/**
 * `text` without the one line ending that closes its last line: pasted against the end of a line
 * it breaks nothing, and kept it would leave a blank line inside the paragraph. A whole blank line
 * at the end stays, since the clipboard carried it as a block of its own.
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
	preDelete?: PasteRange,
	seam?: PasteSeam
): StructuralPasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const cut = applyPreDelete(node, display, preDelete, offset, seam);
	// Compare the bytes rather than the range: a cleanup can drop more than the selection did,
	// and an empty range leaves them equal, which is exactly when the original node stands.
	const synthLeaf =
		cut.display === display ? node : { ...node, raw: cut.display + trailingLineEnding(node.raw) };

	const { nodes, lastPastedIndex } = buildPastedReplacement(
		synthLeaf,
		cut.offset,
		blocks,
		seam?.grammar
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

/** Test-only: produce a default text surface descriptor. */
export function __getDefaultTextSurface(kind: PasteSurface['kind']): PasteSurface {
	return {
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	};
}

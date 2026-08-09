/**
 * Default paste hooks for kinds with no bespoke PasteSurface, registered at module load
 * for every built-in kind whose descriptor advertises `supportsInline`.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { buildPastedReplacement } from '../paste-replacement';
import { cutRangeFromDisplay } from '../node-ops';
import { focusIndexBeforeResidue } from './focus-target';
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
 * The leaf's bytes and caret after the paste's DELETE half — through the one join seam, so a cut
 * that stranded a delimiter run the reader never saw drops it here rather than pasting it into
 * view (§ 4.5). The range is forwarded whole: the endpoints are the seam's to read.
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

	const newDisplay =
		effectiveDisplay.slice(0, effectiveOffset) + text + effectiveDisplay.slice(effectiveOffset);

	return {
		newRaw: newDisplay + lineEnding,
		caretOffset: effectiveOffset + text.length
	};
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
	// Compare the BYTES rather than the range: a cleanup can drop more than the selection did,
	// and an empty range leaves them equal, which is exactly when the original node stands.
	const synthLeaf =
		cut.display === display ? node : { ...node, raw: cut.display + trailingLineEnding(node.raw) };

	const replacement = buildPastedReplacement(synthLeaf, cut.offset, blocks);
	return {
		replacement,
		focusReplacementIndex: pastedContentFocusIndex(cut.display, cut.offset, replacement.length),
		focusOffset: CURSOR_END
	};
}

/**
 * Caret target for a structural paste: the end of the PASTED content, not the trailing
 * residue. A mid-block caret leaves the post-caret slice as the replacement's last node,
 * so the pasted content ends one node earlier. Takes the display and offset the delete half
 * already resolved — a seam cleanup moves both, and re-deriving them here would disagree.
 */
export function pastedContentFocusIndex(
	display: string,
	offset: number,
	replacementLength: number
): number {
	return focusIndexBeforeResidue(replacementLength, offset < display.length);
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

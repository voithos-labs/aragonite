/**
 * Default paste hooks for kinds with no bespoke PasteSurface, registered at module load
 * for every built-in kind whose descriptor advertises `supportsInline`.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { buildPastedReplacement } from '../paste-replacement';
import { focusIndexBeforeResidue } from './focus-target';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '../../schema/block-kind-descriptor';
import {
	registerPasteSurface,
	type PasteSurface,
	type PasteRange,
	type InlinePasteResult,
	type StructuralPasteResult
} from '../paste-surfaces';

// Registered by their own component instead of the loop below. One registrar per kind, so
// correctness doesn't hinge on module load order.
const BESPOKE_SURFACE_KINDS = new Set<BlockKind>(['tableCell']);

/** Splice a pre-delete selection range out of a leaf's display text. */
function cutPreDelete(display: string, preDelete: PasteRange): string {
	return display.slice(0, preDelete.start) + display.slice(preDelete.end);
}

export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const lineEnding = trailingLineEnding(node.raw);

	let effectiveDisplay = display;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		effectiveDisplay = cutPreDelete(display, preDelete);
		effectiveOffset = preDelete.start;
	}

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
	preDelete?: PasteRange
): StructuralPasteResult {
	let synthLeaf = node;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		const display = trimTrailingLineEnding(node.raw);
		const lineEnding = trailingLineEnding(node.raw);
		synthLeaf = { ...node, raw: cutPreDelete(display, preDelete) + lineEnding };
		effectiveOffset = preDelete.start;
	}

	const replacement = buildPastedReplacement(synthLeaf, effectiveOffset, blocks);
	return {
		replacement,
		focusReplacementIndex: pastedContentFocusIndex(node, offset, preDelete, replacement.length),
		focusOffset: CURSOR_END
	};
}

/**
 * Caret target for a structural paste: the end of the PASTED content, not the trailing
 * residue. A mid-block caret leaves the post-caret slice as the replacement's last node,
 * so the pasted content ends one node earlier.
 */
export function pastedContentFocusIndex(
	node: NodeView,
	offset: number,
	preDelete: PasteRange | undefined,
	replacementLength: number
): number {
	const display = trimTrailingLineEnding(node.raw);
	const cut = preDelete && preDelete.start < preDelete.end;
	const effectiveDisplay = cut ? cutPreDelete(display, preDelete) : display;
	const effectiveOffset = cut ? preDelete.start : offset;
	const hasTrailingResidue = effectiveOffset < effectiveDisplay.length;
	return focusIndexBeforeResidue(replacementLength, hasTrailingResidue);
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

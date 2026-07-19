/**
 * Default inline and structural paste hooks used when a block kind has no
 * bespoke PasteSurface. Also registers these defaults for every kind whose
 * descriptor advertises `supportsInline` at module-load time.
 */

import { CURSOR_END } from '../../block-component';
import { isBuiltinBlockKind, type BlockKind, type CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trimTrailingLineEnding } from '../../core/lines';
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

// Kinds whose surface is registered by their component (top of the DAG) instead
// of the default loop below. Skipping them keeps a single registrar per kind, so
// correctness doesn't hinge on whether this module loads before or after the
// component wire-up.
const BESPOKE_SURFACE_KINDS = new Set<BlockKind>(['tableCell']);

export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';

	let effectiveDisplay = display;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		effectiveDisplay = display.slice(0, preDelete.start) + display.slice(preDelete.end);
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
		const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';
		const effectiveRaw =
			display.slice(0, preDelete.start) + display.slice(preDelete.end) + lineEnding;
		synthLeaf = { ...node, raw: effectiveRaw };
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
 * Caret target for a structural paste: the end of the PASTED content, not the
 * trailing residue. A caret that sat mid-block appends the post-caret slice as
 * the replacement's last node (buildPastedReplacement), so the pasted content
 * ends one node earlier; an end-of-block paste has no residue and lands on the
 * last node as before.
 */
export function pastedContentFocusIndex(
	node: NodeView,
	offset: number,
	preDelete: PasteRange | undefined,
	replacementLength: number
): number {
	const display = trimTrailingLineEnding(node.raw);
	const cut = preDelete && preDelete.start < preDelete.end;
	const effectiveDisplay = cut
		? display.slice(0, preDelete.start) + display.slice(preDelete.end)
		: display;
	const effectiveOffset = cut ? preDelete.start : offset;
	const hasTrailingResidue = effectiveOffset < effectiveDisplay.length;
	return focusIndexBeforeResidue(replacementLength, hasTrailingResidue);
}

// Built-in kinds register on block-kind-descriptor import, which is transitively
// completed before this module's top-level executes. Plugin kinds registering
// after this point must register their own paste surface.
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

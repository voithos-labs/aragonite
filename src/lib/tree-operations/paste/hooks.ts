/**
 * Default inline and structural paste hooks used when a block kind has no
 * bespoke PasteSurface. Also registers these defaults for every kind whose
 * descriptor advertises `supportsInline` at module-load time.
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { buildPastedReplacement } from '../paste-replacement';
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
import {
	tableCellInlinePaste,
	tableCellStructuralPaste
} from '../../components/blocks/table/table-cell-paste';

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
		focusReplacementIndex: replacement.length - 1,
		focusOffset: CURSOR_END
	};
}

// Built-in kinds register on block-kind-descriptor import, which is transitively
// completed before this module's top-level executes. Plugin kinds registering
// after this point must register their own paste surface.
for (const kind of getAllRegisteredKinds()) {
	if (tryGetBlockKindDescriptor(kind)?.supportsInline) {
		registerPasteSurface({
			kind,
			onInlinePaste: defaultInlineHook,
			onStructuralPaste: defaultStructuralHook
		});
	}
}

// Override the auto-registered defaults for tableCell. The structural sentinel
// is never invoked — pasteDispatch intercepts tableCell + structural before
// reaching the surface hook. Registering it (instead of leaving onStructuralPaste
// undefined) keeps surfaceForcesInline === false so structural clipboards reach
// the break-and-splice branch instead of being forced through inline.
registerPasteSurface({
	kind: 'tableCell',
	onInlinePaste: tableCellInlinePaste,
	onStructuralPaste: tableCellStructuralPaste
});

/** Test-only: produce a default text surface descriptor. */
export function __getDefaultTextSurface(kind: PasteSurface['kind']): PasteSurface {
	return {
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	};
}

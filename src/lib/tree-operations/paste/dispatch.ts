/**
 * Single entry point for paste: parse the clipboard, pick inline vs structural, route
 * through the target's PasteSurface. Inline/structural surfaces are stateless transforms
 * this module applies; scoped-structural surfaces own their whole mutation including focus.
 * Cross-block paste (`undoEntry: 'join'`) uses DOM-level focus, because the originating
 * block's `pendingCursorOffset` may address a block the range delete is about to unmount.
 */

import type { BlockEditActions, UndoEntryMode } from '../../action-contracts';
import type { CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import type { PluginActivation } from '../../schema/plugin-activation';
import { parse } from '../../core/parser';
import { cutRangeFromDisplay, isBlockNode, nodeAt } from '../node-ops';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import {
	getPasteSurface,
	type PasteRange,
	type PasteSeam,
	type PasteSurface,
	type StructuralPasteResult
} from '../paste-surfaces';
import { isReservedChromeChild } from '../../schema/reserved-chrome';
import { applyInlineResult, applyStructuralResult } from './apply';
import { normalizeClipboardForBody } from './body-write';
import { applyContainerMatchingPaste, findContainerMatchingUnwrap } from './container-match';
import { defaultInlineHook, defaultStructuralHook } from './hooks';
import { devWarn } from '../../dev-warn';
import { applyListAbsorb, findListAbsorb } from './list-absorb';
import { applyListBreakOut, findListBreakOut } from './list-break-out';
import type { PasteCommitCoordinator } from './paste-deps';
import { applyPasteTransforms } from './paste-transforms';
import { contentBlocks, pickPasteStrategy } from './strategy';

export type PasteStrategy = 'inline' | 'structural';

export interface PasteDispatchInput {
	/** Raw clipboard text. */
	pastedText: string;
	/** Path from Document root to the target node. Length ≥ 1. */
	targetPath: number[];
	/** Caret offset within the target node's raw. */
	offset: number;
	/** Selection range within the target's raw (not cross-block). */
	preDelete?: PasteRange;
}

export interface PasteDispatchContext {
	doc: Document;
	/** Action bundle for the target's level. Not used in cross-block (undoEntry: 'join') mode. */
	blockEdit: BlockEditActions;
	/** Commit coordinator — required by the multi-scope commit sites inside this module. */
	controller: PasteCommitCoordinator;
	/** `'join'`: the cross-block caller owns the undo entry, so no snapshot is pushed here. */
	undoEntry?: UndoEntryMode;
	/** The instance's grammar for the join branch's same-slot reparse; absent = global. */
	grammar?: GrammarView;
	/** The plugins this instance activated, so an unlisted plugin's paste transform stays out
	 *  of the pipeline; absent = every installed plugin. */
	activePlugins?: PluginActivation;
	/** What the paste's DELETE half needs to cross the join seam; absent leaves it byte-literal. */
	seam?: PasteSeam;
}

/** Where an inline paste's caret belongs once the commit settled, when that moved it. */
export interface InlineCaretLanding {
	path: number[];
	offset: number;
}

export interface PasteDispatchResult {
	/**
	 * Inline-paste caret offset; undefined for structural paste, which handles focus
	 * itself. Single-block callers apply it synchronously with the raw mutation so both
	 * land in one reactive flush.
	 */
	inlineCaretOffset?: number;
	/** The cross-block route's settled landing: a fold above the target moved the slot itself. */
	inlineCaretPath?: number[];
}

/** Execute a paste at the specified target position. */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<PasteDispatchResult> {
	if (!input.pastedText) return {};

	// Once, before any branch below reads the text; a transform that empties it is an
	// empty paste.
	const transformed = applyPasteTransforms(input.pastedText, ctx.activePlugins);
	if (!transformed) return {};

	// Ahead of the fragment parse, so the strategy pick and every landed kind follow the
	// bytes a bodyWrite-declaring ancestor will actually accept.
	const pastedText = normalizeClipboardForBody(ctx.doc, input.targetPath, transformed);

	const parsed = parse(pastedText, { scope: 'fragment' });
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// A reserved-chrome leaf is single-line by serialization, so paste there is forced inline
	// ahead of the container-paste family: a multi-block clipboard must never split it. The trim
	// drops the edge spaces the newline flattening minted, not bytes anyone copied.
	const chromeParent = nodeAt(ctx.doc, input.targetPath.slice(0, -1));
	if (
		chromeParent &&
		isBlockNode(chromeParent) &&
		isReservedChromeChild(chromeParent, input.targetPath[input.targetPath.length - 1])
	) {
		const flattened = pastedText.replace(/(\r?\n)+/g, ' ').trim();
		const hook = getPasteSurface(targetNode.kind)?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, flattened, input.preDelete, ctx.seam);
		const landing = await applyInlineResult(input.targetPath, result, ctx);
		return inlineCaretResult(result.caretOffset, landing);
	}

	// The delete half the container routes never ran, spent ONCE and ahead of the strategy pick:
	// each finder decides on the TARGET's bytes, and a range still standing there answers about
	// bytes the paste is removing. The hook routes cut their own, kind rules included.
	const target = targetAfterPreDelete(targetNode, input, ctx.seam);

	const unwrap = findContainerMatchingUnwrap(
		ctx.doc,
		input.targetPath,
		target.offset,
		parsed,
		ctx.undoEntry === 'join',
		target.raw
	);
	if (unwrap) {
		await applyContainerMatchingPaste(unwrap, ctx);
		return {};
	}

	// The rest of the container paste-merge family, for single-block non-empty targets:
	// absorb when `matchesAncestor` accepts the enclosing container, break-out when it
	// does not.
	const absorb = findListAbsorb(ctx.doc, input.targetPath, parsed, target.offset, target.raw);
	if (absorb) {
		await applyListAbsorb(absorb, parsed.children[0], ctx);
		return {};
	}
	const breakOut = findListBreakOut(ctx.doc, input.targetPath, parsed, target.offset, target.raw);
	if (breakOut) {
		await applyListBreakOut(breakOut, parsed.children, ctx);
		return {};
	}

	const surface = getPasteSurface(targetNode.kind);
	if (surface === undefined) {
		devWarn(
			'paste-dispatch',
			'no paste surface registered for this kind; falling through to default hooks. Register ' +
				'via registerPasteSurface() if the kind has its own paste semantics',
			targetNode.kind
		);
	}
	const blocks = surface?.blankEdgesArePackaging ? contentBlocks(parsed.children) : parsed.children;
	const clipboardStrategy = pickPasteStrategy(blocks);

	// A surface omitting both structural hooks (code blocks) forces paste inline, so its
	// markdown stays verbatim.
	const surfaceForcesInline =
		surface !== undefined &&
		surface.onStructuralPaste === undefined &&
		surface.onScopedStructuralPaste === undefined;
	const strategy: PasteStrategy = surfaceForcesInline ? 'inline' : clipboardStrategy;

	if (strategy === 'structural' && surface?.onScopedStructuralPaste) {
		await surface.onScopedStructuralPaste({
			doc: ctx.doc,
			targetPath: input.targetPath,
			blocks: blocks.slice(),
			controller: ctx.controller,
			undoEntry: ctx.undoEntry ?? 'own'
		});
		return {};
	}

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, pastedText, input.preDelete, ctx.seam);
		const landing = await applyInlineResult(input.targetPath, result, ctx);
		return inlineCaretResult(result.caretOffset, landing);
	}

	const hook = surface?.onStructuralPaste ?? defaultStructuralHook;
	const result = hook(targetNode, input.offset, blocks.slice(), input.preDelete, ctx.seam);
	await applyStructuralResult(
		input.targetPath,
		result,
		ctx,
		trailingSeparatorOf(parsed, result, surface)
	);
	return {};
}

/** The target's bytes and caret as the paste's delete half leaves them. */
function targetAfterPreDelete(
	node: CstNode,
	input: PasteDispatchInput,
	seam: PasteSeam | undefined
): { raw: string; offset: number } {
	if (!input.preDelete) return { raw: node.raw, offset: input.offset };
	const cut = cutRangeFromDisplay(
		node,
		trimTrailingLineEnding(node.raw),
		input.preDelete,
		seam?.presentationMode,
		seam?.linkRef
	);
	return { raw: cut.display + trailingLineEnding(node.raw), offset: cut.offset };
}

/**
 * A clipboard's trailing blank line is CONTENT: a parse folds exactly one into `suffix`
 * while a second already materializes as a block, and the inline route splices the bytes verbatim
 * — so consuming children alone made one route keep the copied separation and its twin lose it.
 * Spent only where the splice leaves nothing behind the pasted blocks; a residue or a follower
 * already carries a separator of its own, and a packaging surface declines the whole question.
 */
function trailingSeparatorOf(
	parsed: Document,
	result: StructuralPasteResult,
	surface: PasteSurface | undefined
): string {
	if (surface?.blankEdgesArePackaging) return '';
	// `focusReplacementIndex` IS the last pasted node (`paste/focus-target.ts`), so anything past
	// it is reattached residue.
	return result.focusReplacementIndex === result.replacement.length - 1 ? parsed.suffix : '';
}

/** The hook's own caret offset, overridden by the settled landing where a fold moved it. */
function inlineCaretResult(
	caretOffset: number,
	landing: InlineCaretLanding | undefined
): PasteDispatchResult {
	if (!landing) return { inlineCaretOffset: caretOffset };
	return { inlineCaretOffset: landing.offset, inlineCaretPath: landing.path };
}

export { pickPasteStrategy } from './strategy';
export { defaultInlineHook, defaultStructuralHook, __getDefaultTextSurface } from './hooks';

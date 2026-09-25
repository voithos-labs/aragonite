/**
 * Single entry point for paste: parse the clipboard, pick inline or structural, and route through
 * the target kind's `PasteSurface` (its paste handlers), whose inline and structural results this
 * module applies; a scoped-structural handler owns its whole mutation, focus included. A
 * cross-block paste focuses through the DOM, since its range delete may unmount the origin block.
 */

import type { BlockEditActions, UndoEntryMode } from '../../action-contracts';
import type { CstNode, Document } from '../../core/nodes';
import type { Reading } from '../../schema/reading';
import type { PluginActivation } from '../../schema/plugin-activation';
import { parse } from '../../core/parser';
import { isBlockNode, nodeAt } from '../node-primitives';
import { cutRangeFromDisplay } from '../node-ops';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import {
	getPasteSurface,
	isPasteSurfaceRegistered,
	type PasteRange,
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
import { inlineResultInEnding, pasteLineEnding } from './line-ending';
import { withLineEnding } from '../../core/lines';
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
	/** Commit coordinator, required by the multi-scope commit sites inside this module. */
	controller: PasteCommitCoordinator;
	/** `'join'`: the cross-block caller owns the undo entry, so no snapshot is pushed here. */
	undoEntry?: UndoEntryMode;
	/** The instance's reading: the clipboard parse and the join branch's same-slot reparse read its
	 *  grammar, so an unlisted plugin's opener never takes pasted bytes, and the delete half is a
	 *  join its mode decides the cleanup of. */
	reading: Reading;
	/** The plugins this instance activated, so an unlisted plugin's paste hooks stay out. */
	activePlugins: PluginActivation;
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
	/** Where the cross-block route's caret ended up, when a merge above the target moved the
	 *  block itself. */
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
	const { activePlugins } = ctx;
	const { reading } = ctx;
	const transformed = applyPasteTransforms(input.pastedText, activePlugins);
	if (!transformed) return {};

	// Ahead of the fragment parse, so the strategy pick and every landed kind follow the
	// bytes a bodyWrite-declaring ancestor will actually accept.
	const pastedText = normalizeClipboardForBody(ctx.doc, input.targetPath, transformed);

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// The hooks read the LF text; the blocks are parsed in the document's own ending, since their
	// bytes are what every block route writes.
	const ending = pasteLineEnding(ctx.doc, input.targetPath, targetNode, input.offset);
	const parsed = parse(withLineEnding(pastedText, ending), {
		grammar: reading.grammar,
		scope: 'fragment'
	});
	if (parsed.children.length === 0) return {};

	// A reserved title child serializes on one line, so paste there is forced inline before any
	// container route could split it; the trim drops only the spaces the flattening made.
	const chromeParent = nodeAt(ctx.doc, input.targetPath.slice(0, -1));
	if (
		chromeParent &&
		isBlockNode(chromeParent) &&
		isReservedChromeChild(chromeParent, input.targetPath[input.targetPath.length - 1])
	) {
		const flattened = pastedText.replace(/(\r?\n)+/g, ' ').trim();
		const hook =
			getPasteSurface(targetNode.kind, activePlugins)?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, flattened, input.preDelete, reading);
		const landing = await applyInlineResult(input.targetPath, result, ctx);
		return inlineCaretResult(result.caretOffset, landing);
	}

	// The delete half, applied before the container finders, which decide on the target's bytes and
	// never cut the range themselves; the hook routes cut their own, kind rules included.
	const target = targetAfterPreDelete(targetNode, input, reading);

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

	// For a single-block non-empty target: absorb when `matchesAncestor` accepts the enclosing
	// container, break out when it does not.
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

	const surface = getPasteSurface(targetNode.kind, activePlugins);
	// A plugin's surface this editor left out is no gap to warn about: the default hooks are meant.
	if (surface === undefined && !isPasteSurfaceRegistered(targetNode.kind)) {
		devWarn(
			'paste-dispatch',
			'no paste surface registered for this kind; falling through to default hooks. Register ' +
				'via registerPasteSurface() if the kind has its own paste semantics',
			targetNode.kind
		);
	}
	const blocks = surface?.blankEdgesArePackaging ? contentBlocks(parsed.children) : parsed.children;
	const clipboardStrategy = pickPasteStrategy(blocks);

	// A kind whose paste handlers omit both structural hooks (code blocks) forces paste inline,
	// so its markdown stays verbatim.
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
			undoEntry: ctx.undoEntry ?? 'own',
			grammar: reading.grammar
		});
		return {};
	}

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = inlineResultInEnding(
			targetNode.raw,
			hook(targetNode, input.offset, pastedText, input.preDelete, reading),
			ending
		);
		const landing = await applyInlineResult(input.targetPath, result, ctx);
		return inlineCaretResult(result.caretOffset, landing);
	}

	const hook = surface?.onStructuralPaste ?? defaultStructuralHook;
	const result = hook(targetNode, input.offset, blocks.slice(), input.preDelete, reading);
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
	reading: Reading
): { raw: string; offset: number } {
	if (!input.preDelete) return { raw: node.raw, offset: input.offset };
	const cut = cutRangeFromDisplay(node, trimTrailingLineEnding(node.raw), input.preDelete, reading);
	return { raw: cut.display + trailingLineEnding(node.raw), offset: cut.offset };
}

/**
 * A clipboard's trailing blank line is content the parser keeps in `suffix`, which the inline
 * route pastes verbatim, so the structural route lands it too. Only where nothing follows the
 * pasted blocks in the splice (a residue carries its own separator), and never for a kind that
 * treats blank edges as packaging.
 */
function trailingSeparatorOf(
	parsed: Document,
	result: StructuralPasteResult,
	surface: PasteSurface | undefined
): string {
	if (surface?.blankEdgesArePackaging) return '';
	// `focusReplacementIndex` is the last pasted node (`paste/focus-target.ts`), so anything past
	// it is reattached residue.
	return result.focusReplacementIndex === result.replacement.length - 1 ? parsed.suffix : '';
}

/** The hook's own caret offset, overridden by where the caret ended up when a merge moved it. */
function inlineCaretResult(
	caretOffset: number,
	landing: InlineCaretLanding | undefined
): PasteDispatchResult {
	if (!landing) return { inlineCaretOffset: caretOffset };
	return { inlineCaretOffset: landing.offset, inlineCaretPath: landing.path };
}

export { pickPasteStrategy } from './strategy';
export { defaultInlineHook, defaultStructuralHook } from './hooks';

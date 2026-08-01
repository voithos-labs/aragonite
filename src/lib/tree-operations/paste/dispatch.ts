/**
 * Single entry point for paste: parse the clipboard, pick inline vs structural, route
 * through the target's PasteSurface. Inline/structural surfaces are stateless transforms
 * this module applies; scoped-structural surfaces own their whole mutation including focus.
 * Cross-block paste (`undoEntry: 'join'`) uses DOM-level focus, because the originating
 * block's `pendingCursorOffset` may address a block the range delete is about to unmount.
 */

import { DEV } from 'esm-env';
import type { BlockEditActions, UndoEntryMode } from '../../action-contracts';
import type { CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import { parse } from '../../core/parser';
import { trailingLineEnding } from '../../core/lines';
import { isBlockNode, nodeAt } from '../node-ops';
import { getPasteSurface, type PasteRange } from '../paste-surfaces';
import { isReservedChromeChild } from '../../schema/reserved-chrome';
import { applyInlineResult, applyStructuralResult } from './apply';
import { applyContainerMatchingPaste, findContainerMatchingUnwrap } from './container-match';
import { defaultInlineHook, defaultStructuralHook } from './hooks';
import { applyListAbsorb, findListAbsorb } from './list-absorb';
import { applyListBreakOut, findListBreakOut } from './list-break-out';
import type { PasteCommitCoordinator } from './paste-deps';
import { applyPasteTransforms } from './paste-transforms';
import { materializeBlankLines, pickPasteStrategy } from './strategy';

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
}

export interface PasteDispatchResult {
	/**
	 * Inline-paste caret offset; undefined for structural paste, which handles focus
	 * itself. Single-block callers apply it synchronously with the raw mutation so both
	 * land in one reactive flush.
	 */
	inlineCaretOffset?: number;
}

/** Execute a paste at the specified target position. */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<PasteDispatchResult> {
	if (!input.pastedText) return {};

	// Once, before any branch below reads the text; a transform that empties it is an
	// empty paste.
	const pastedText = applyPasteTransforms(input.pastedText);
	if (!pastedText) return {};

	const parsed = parse(pastedText, { scope: 'fragment' });
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// A reserved-chrome leaf is single-line by serialization (its bytes live in the
	// container's opener line), so paste there is forced inline and flattened ahead of the
	// container-paste family — a multi-block clipboard must never split the chrome node.
	const chromeParent = nodeAt(ctx.doc, input.targetPath.slice(0, -1));
	if (
		chromeParent &&
		isBlockNode(chromeParent) &&
		isReservedChromeChild(chromeParent, input.targetPath[input.targetPath.length - 1])
	) {
		const flattened = pastedText.replace(/(\r?\n)+/g, ' ').trim();
		const hook = getPasteSurface(targetNode.kind)?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, flattened, input.preDelete);
		await applyInlineResult(input.targetPath, result, ctx);
		return { inlineCaretOffset: result.caretOffset };
	}

	const unwrap = findContainerMatchingUnwrap(
		ctx.doc,
		input.targetPath,
		input.offset,
		parsed,
		ctx.undoEntry === 'join'
	);
	if (unwrap) {
		await applyContainerMatchingPaste(unwrap, ctx);
		return {};
	}

	// The rest of the container paste-merge family, for single-block non-empty targets:
	// absorb when `matchesAncestor` accepts the enclosing container, break-out when it
	// does not.
	const absorb = findListAbsorb(ctx.doc, input.targetPath, parsed, input.offset);
	if (absorb) {
		await applyListAbsorb(absorb, parsed.children[0], ctx);
		return {};
	}
	const breakOut = findListBreakOut(ctx.doc, input.targetPath, parsed, input.offset);
	if (breakOut) {
		await applyListBreakOut(breakOut, parsed.children, ctx);
		return {};
	}

	const surface = getPasteSurface(targetNode.kind);
	if (DEV && surface === undefined) {
		console.warn(
			`[paste-dispatch] No paste surface registered for kind`,
			targetNode.kind,
			`— falling through to default hooks. Register via registerPasteSurface() if this kind has its own paste semantics.`
		);
	}
	const clipboardStrategy = pickPasteStrategy(parsed);

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
			blocks: materializeBlankLines(parsed.children, trailingLineEnding(targetNode.raw)),
			controller: ctx.controller,
			undoEntry: ctx.undoEntry ?? 'own'
		});
		return {};
	}

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, pastedText, input.preDelete);
		await applyInlineResult(input.targetPath, result, ctx);
		return { inlineCaretOffset: result.caretOffset };
	}

	const hook = surface?.onStructuralPaste ?? defaultStructuralHook;
	const blocks = materializeBlankLines(parsed.children, trailingLineEnding(targetNode.raw));
	const result = hook(targetNode, input.offset, blocks, input.preDelete);
	await applyStructuralResult(input.targetPath, result, ctx);
	return {};
}

export { pickPasteStrategy } from './strategy';
export { defaultInlineHook, defaultStructuralHook, __getDefaultTextSurface } from './hooks';

/**
 * Single entry point for paste. Parses the clipboard, picks inline vs
 * structural, looks up the target's PasteSurface, and routes the mutation.
 * Inline/structural surfaces are stateless data transforms whose results
 * this module applies; scoped-structural surfaces own their whole mutation,
 * including focus.
 *
 * Cross-block inline paste (undoEntry: 'join') bypasses updateBlockContent
 * and uses DOM-level focus because the originating block's pendingCursorOffset
 * may address a block about to be unmounted by the range delete.
 */

import type { BlockEditActions, UndoEntryMode } from '../../action-contracts';
import type { CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import { parse } from '../../core/parser';
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
	/** `'join'`: no snapshot or updateBlockContent debounce here — the cross-block caller owns the undo entry. */
	undoEntry?: UndoEntryMode;
	/** The instance's block grammar for the join branch's
	 *  same-slot reparse. Absent = the global grammar; the non-join branch threads its own via
	 *  updateBlockContent. */
	grammar?: GrammarView;
}

export interface PasteDispatchResult {
	/**
	 * Inline-paste caret offset. Single-block callers set `pendingCursorOffset`
	 * synchronously with the raw mutation so both land in one reactive flush;
	 * cross-block callers restore the DOM caret after reactivity settles.
	 * Undefined for structural paste (focus handled internally).
	 */
	inlineCaretOffset?: number;
}

/** Execute a paste at the specified target position. */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<PasteDispatchResult> {
	if (!input.pastedText) return {};

	// Content-keyed plugin transforms rewrite the clipboard text once, before any
	// branch below reads it; a transform that empties the text is an empty paste.
	const pastedText = applyPasteTransforms(input.pastedText);
	if (!pastedText) return {};

	const parsed = parse(pastedText);
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// A reserved-chrome leaf (a container's title/summary at child 0) is single-
	// line by serialization — its bytes live in the container's opener line. Force
	// any paste there inline with flattened text, ahead of the container-paste
	// family below, so a multi-block clipboard can never split the chrome node.
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

	// Container paste-merge family, gated by the clipboard-top kind's
	// `containerPaste` declaration. Container-match (above) handles empty-target
	// and cross-block flatten; absorb and break-out cover single-block non-empty
	// targets — absorb splices clipboard items as siblings when `matchesAncestor`
	// accepts the enclosing container (Obsidian / Google Docs convention),
	// break-out splits it at the target and splices at the parent level when
	// the match fails.
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
	if (import.meta.env.DEV && surface === undefined) {
		console.warn(
			`[paste-dispatch] No paste surface registered for kind`,
			targetNode.kind,
			`— falling through to default hooks. Register via registerPasteSurface() if this kind has its own paste semantics.`
		);
	}
	const clipboardStrategy = pickPasteStrategy(parsed);

	// Surfaces that omit both structural hooks (e.g. code blocks) force all
	// paste into the inline hook so markdown stays verbatim.
	const surfaceForcesInline =
		surface !== undefined &&
		surface.onStructuralPaste === undefined &&
		surface.onScopedStructuralPaste === undefined;
	const strategy: PasteStrategy = surfaceForcesInline ? 'inline' : clipboardStrategy;

	if (strategy === 'structural' && surface?.onScopedStructuralPaste) {
		await surface.onScopedStructuralPaste({
			doc: ctx.doc,
			targetPath: input.targetPath,
			blocks: materializeBlankLines(parsed.children),
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
	const blocks = materializeBlankLines(parsed.children);
	const result = hook(targetNode, input.offset, blocks, input.preDelete);
	await applyStructuralResult(input.targetPath, result, ctx);
	return {};
}

export { pickPasteStrategy } from './strategy';
export { defaultInlineHook, defaultStructuralHook, __getDefaultTextSurface } from './hooks';

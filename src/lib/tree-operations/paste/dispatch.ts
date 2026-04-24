/**
 * Single entry point for paste. Parses the clipboard, picks inline vs
 * structural, looks up the target's PasteSurface, and routes the mutation.
 * Surfaces are stateless data transforms; this module owns parsing,
 * strategy selection, mutation routing, and focus landing.
 *
 * Cross-block inline paste (skipSnapshot) bypasses updateBlockContent and
 * uses DOM-level focus because the originating block's pendingCursorOffset
 * may address a block about to be unmounted by the range delete.
 */

import type { UndoController } from '../../editor-actions/deps';
import type { CstNode, Document } from '../../core/nodes';
import type { BlockEditActions } from '../../contracts';
import { parse } from '../../core/parser';
import { nodeAt } from '../node-ops';
import { getPasteSurface, type PasteRange } from '../paste-surfaces';
import { pickPasteStrategy, materializeBlankLines } from './strategy';
import { defaultInlineHook, defaultStructuralHook } from './hooks';
import { applyInlineResult, applyStructuralResult } from './apply';
import { findContainerMatchingUnwrap, applyContainerMatchingPaste } from './container-match';
import { findListAbsorb, applyListAbsorb } from './list-absorb';
import { findListBreakOut, applyListBreakOut } from './list-break-out';

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
	/** Action bundle for the target's level. Not used in cross-block (skipSnapshot) mode. */
	blockEdit: BlockEditActions;
	/** Undo controller — required by the multi-scope commit sites inside this module. */
	controller: UndoController;
	/** Skip undo snapshot + updateBlockContent debounce. Cross-block callers push the snapshot themselves. */
	skipSnapshot?: boolean;
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

	const parsed = parse(input.pastedText);
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	const unwrap = findContainerMatchingUnwrap(
		ctx.doc,
		input.targetPath,
		input.offset,
		parsed,
		ctx.skipSnapshot === true
	);
	if (unwrap) {
		await applyContainerMatchingPaste(unwrap, ctx);
		return {};
	}

	// Paste-into-list family (same-type absorb + mismatched break-out). Runs
	// after container-match, which handles empty-target and cross-block flatten;
	// these two cover single-block non-empty targets.
	//
	//   - Absorb (types match): splice items as siblings in the enclosing list,
	//     renumber from 1. Matches Obsidian / Google Docs convention.
	//   - Break-out (types mismatch): split the enclosing list at the target,
	//     splice the pasted list at the parent level, preserving its type.
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

	// Surfaces that omit `onStructuralPaste` (e.g. code blocks) force all
	// paste into the inline hook so markdown stays verbatim.
	const surfaceForcesInline = surface !== undefined && surface.onStructuralPaste === undefined;
	const strategy: PasteStrategy = surfaceForcesInline ? 'inline' : clipboardStrategy;

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, input.pastedText, input.preDelete);
		applyInlineResult(input.targetPath, result, ctx);
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

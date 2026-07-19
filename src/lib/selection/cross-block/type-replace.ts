/**
 * Cross-block type-replace: the user typed a character with a cross-block
 * selection active. Delete the range, splice the typed character into the
 * surviving leaf's raw, and rebuild ancestry when the leaf sits inside a
 * container. Routed through commitMultiScope so the mutation matches the
 * single-block update path (ids/refs reactivity, op:'input' emission).
 */

import type { MultiScopeTarget } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { blockNodeAt } from '../../tree-operations/node-ops';
import { applyCollapsedCaret } from '../native-bridge';
import {
	ensureUnsharedNode,
	ensureUnsharedPath,
	rebuildUnsharedChain
} from '../../tree-operations/unshare';
import { getStateForNode } from '../../reactivity/state-registry';
import { docPathFrom } from '../../cursor/coordinate-spaces';

export async function handleCrossBlockTypeReplace(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: InputEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock || e.inputType !== 'insertText') return false;

	e.preventDefault();
	const typed = e.data ?? '';
	const caret = await performCrossBlockDelete(mutCtx, { skipCaretRestore: true });
	if (!caret) return true;
	// All caret placements below target caret.path's top-level block; mount it
	// once here so each (including the non-awaited afterTick) finds a live element.
	await ctx.revealPath(caret.path);
	if (!typed) {
		applyCaretAtPath(ctx, caret);
		return true;
	}

	const doc = ctx.getDoc();
	const targetNode = blockNodeAt(doc, caret.path);
	if (!targetNode) {
		applyCaretAtPath(ctx, caret);
		return true;
	}

	// Route the splice through commitMultiScope so the mutation lands inside
	// the commit primitive: parallel ids/refs reactivity contract honored,
	// op:'input' event emitted symmetrically with the single-block path
	// (block-edit.ts updateBlockContent → debounced flush). snapshot: 'skip'
	// keeps the typed character in the same undo unit as performCrossBlockDelete.
	const scope = resolveTypedCharScope(ctx, caret.path);
	if (!scope) {
		applyCaretAtPath(ctx, caret);
		return true;
	}

	await ctx.controller.commitMultiScope({
		scopes: [scope],
		snapshot: 'skip',
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			const charOffset = charOffsetOf(caret, 'cross-block-type-replace:slice');
			const chain = ensureUnsharedPath(doc, caret.path, sharing);
			// caret.path resolved above, so the chain reaches the leaf; the
			// fallback still routes through the unshare seam, never a raw capture.
			const owned = chain[chain.length - 1] ?? ensureUnsharedNode(targetNode, sharing);
			owned.raw = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
			rebuildUnsharedChain(chain, sharing);
			return [{ op: 'noop' }];
		},
		op: {
			kind: 'input',
			detail: { byteLength: typed.length },
			eventPath: docPathFrom(caret.path)
		},
		afterTick: () =>
			applyCaretAtPath(ctx, { path: caret.path, offset: caret.offset + typed.length })
	});
	return true;
}

function applyCaretAtPath(
	ctx: CrossBlockDispatchContext,
	point: { path: number[]; offset: number }
): void {
	const blockEl = ctx.getBlockElByPath(point.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, point);
		blockEl.focus();
	}
}

/**
 * Pick the smallest commit scope covering the typed-char target. Doc-scope
 * for top-level leaves; nearest container ancestor with a registered
 * BlockListState for nested leaves. Returns null when no scope is mounted —
 * caller falls back to direct caret restore.
 */
function resolveTypedCharScope(
	ctx: CrossBlockDispatchContext,
	leafPath: number[]
): MultiScopeTarget | null {
	if (leafPath.length === 1) {
		return ctx.controller.getDocScope();
	}
	const doc = ctx.getDoc();
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = leafPath.slice(0, depth);
		const ancestor = blockNodeAt(doc, ancestorPath);
		if (!ancestor) continue;
		const state = getStateForNode(ancestor);
		if (state) return { node: ancestor, state, path: ancestorPath };
	}
	return null;
}

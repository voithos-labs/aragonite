/**
 * Typing a character over a cross-block range: delete the range, splice the character into the
 * surviving leaf and reparse it, so a marker typed at offset 0 changes the kind as single-block
 * typing does. A range holding one block whole leaves no surviving leaf, so the character
 * replaces that block instead.
 */

import type { MultiScopeTarget } from '../../action-contracts';
import type { CstNode } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { blockCoveredWhole } from '../covered-block';
import { CURSOR_END } from '../../block-component';
import { replaceBlockAtParent } from '../../tree-operations/paste/replace-block-at-parent';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import {
	blockNodeAt,
	normalizeBodyWrite,
	writeOwnRaw
} from '../../tree-operations/node-primitives';
import {
	updateNodeContent,
	settledCaretTarget,
	type SettledContent
} from '../../tree-operations/content-write';
import { focusCollapsedCaret } from '../native-bridge';
import {
	ensureUnsharedChild,
	ensureUnsharedNode,
	ensureUnsharedPath
} from '../../tree-operations/unshare';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { stampStructuralChange } from '../../tree-operations/structural-change';
import { getStateForNode } from '../../reactivity/state-registry';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { devWarn } from '../../dev-warn';

export async function handleCrossBlockTypeReplace(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	typed: string
): Promise<void> {
	// A range holding its block whole leaves no leaf to splice into, so the character replaces the
	// block in its own position. An empty insertion has nothing to put there and takes the delete.
	const covered = typed
		? blockCoveredWhole(ctx.getDoc(), ctx.selection.anchor, ctx.selection.focus)
		: null;
	if (covered) {
		await replaceCoveredBlockWithText(ctx, mutCtx, typed, covered);
		return;
	}

	const caret = await performCrossBlockDelete(mutCtx, { skipCaretRestore: true });
	if (!caret) return;
	// All caret placements below target caret.path's top-level block; mount it once here so each
	// (the post-tick landing included) finds a live element.
	await ctx.revealPath(caret.path);
	if (!typed) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return;
	}

	const doc = ctx.getDoc();
	const targetNode = blockNodeAt(doc, caret.path);
	if (!targetNode) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return;
	}

	// `updateContent`, not `input`: consumers read `input` as the kind having held, and this
	// reparse may change it. `snapshot: 'skip'` keeps the character in the delete's undo entry.
	const scope = resolveTypedCharScope(ctx, caret.path);
	if (!scope) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return;
	}

	// Every mounted container registers a `BlockListState`, so the scope is the leaf's parent; an
	// unregistered ancestor would make it a grandparent, and that case splices raw only.
	const leafIndex = caret.path[caret.path.length - 1];
	const scopeIsImmediateParent = scope.path.length === caret.path.length - 1;

	let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
	await ctx.controller.commitMultiScope({
		scopes: [scope],
		snapshot: 'skip',
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			const charOffset = charOffsetOf(caret, 'cross-block-type-replace:slice');

			if (!scopeIsImmediateParent) {
				devWarn(
					'cross-block-type-replace',
					`scope [${scope.path.join(',')}] is not the immediate parent of leaf [${caret.path.join(',')}]; splicing raw without kind re-derivation`
				);
				const chain = ensureUnsharedPath(doc, caret.path, sharing);
				const owned = chain[chain.length - 1] ?? ensureUnsharedNode(targetNode, sharing);
				// Degraded, but still a body write: this branch splices raw with no reparse, so the
				// container's write rule and the leaf's own are all that stand between a typed `>`
				// or backtick and a terminator line.
				const lineEnding = documentLineEnding(doc);
				writeOwnRaw(
					owned,
					normalizeBodyWrite(
						chain[chain.length - 2],
						owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset),
						lineEnding
					),
					lineEnding,
					ctx.reading.grammar
				);
				rebuildUnsharedChain(doc, chain, sharing, null, ctx.reading.grammar);
				return [{ op: 'noop' }];
			}

			// Reparse the spliced leaf inside the commit so a marker at offset 0 re-derives the
			// kind (`updateNodeContent` creates a fresh node on a kind change). A single character
			// never introduces a blank line, so the multi-block replacement branch is unreachable.
			const owned = ensureUnsharedChild(scopeView.node, leafIndex, sharing);
			const newText = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
			settled = updateNodeContent(
				{
					children: scopeView.children,
					ownerKind: scopeView.node.kind,
					owner: scopeView.node,
					lineEnding: scopeView.lineEnding
				},
				leafIndex,
				newText,
				ctx.reading.grammar,
				sharing
			);
			stampStructuralChange(scopeView.children, settled.change, sharing);
			return [settled.change];
		},
		op: {
			kind: 'updateContent',
			// `op` is evaluated ahead of `mutate` and the splice only inserts, so the post-commit
			// length is already fixed. Read for the event detail alone.
			detail: { length: targetNode.raw.length + typed.length },
			eventPath: docPathFrom(caret.path)
		},
		afterTick: async () => {
			// A fix-up that merged the leaf into the block above left that block holding the typed
			// bytes, so the position the delete resolved is no longer where the caret belongs.
			const siblings = scopeChildrenOf(ctx, scope.path);
			const target = settledCaretTarget(settled, leafIndex, caret.offset + typed.length, siblings);
			const path = [...caret.path.slice(0, -1), target.index];
			// The mount above covered the position the delete resolved; a merge can put the caret
			// on one the render window never held.
			if (target.index !== leafIndex) await ctx.revealPath(path);
			focusCollapsedCaret(ctx.getBlockElByPath, {
				path: [...path, ...target.path],
				offset: target.offset
			});
		}
	});
}

/**
 * Replaces the covered block with the parse of the typed character, at the block's parent
 * position: the same call the covered-block paste makes, so both gestures splice in one child
 * list and land one undo entry. Parsed rather than spliced, so a marker typed over the block
 * derives its kind exactly as the single-block typing path does.
 */
async function replaceCoveredBlockWithText(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	typed: string,
	blockPath: number[]
): Promise<void> {
	const doc = ctx.getDoc();
	const covered = blockNodeAt(doc, blockPath);
	if (!covered) return;
	const parsed = parseReplacement(covered, typed, documentLineEnding(doc), ctx.reading.grammar);
	if (!parsed) return;

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await replaceBlockAtParent({
		doc,
		blockPath,
		replacement: parsed.replacement,
		controller: ctx.pasteCoordinator,
		undoEntry: 'join',
		focusReplacementIndex: parsed.replacement.length - 1,
		focusOffset: CURSOR_END,
		source: 'cross-block-covered-block',
		grammar: ctx.reading.grammar
	});
}

/** The container's children, re-read after the commit, which replaces the node it wrote to state. */
function scopeChildrenOf(ctx: CrossBlockDispatchContext, scopePath: number[]): readonly CstNode[] {
	const doc = ctx.getDoc();
	if (scopePath.length === 0) return doc.children;
	return blockNodeAt(doc, scopePath)?.children ?? [];
}

/**
 * The smallest commit scope covering the typed-char target: doc scope for a top-level leaf,
 * nearest container ancestor with a registered BlockListState otherwise. Null when none is
 * mounted, and the caller falls back to a direct caret restore.
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

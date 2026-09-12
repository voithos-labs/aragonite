/**
 * Cross-block type-replace: the user typed a character with a cross-block selection active.
 * Delete the range, splice the character into the surviving leaf's raw, re-parse so a marker at
 * offset 0 re-derives the kind (parity with the single-block type path). Routed through
 * commitMultiScope so a kind change mints a fresh node, ids/refs stay synced, and the op is
 * `updateContent`. A range holding its block whole has no surviving leaf and takes the
 * replace arm at the foot of the file instead.
 */

import type { MultiScopeTarget } from '../../action-contracts';
import type { CstNode } from '../../core/nodes';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { blockCoveredWhole } from '../covered-block';
import { CURSOR_END } from '../../block-component';
import { parse } from '../../core/parser';
import { terminateLine } from '../../core/lines';
import { replaceBlockAtParent } from '../../tree-operations/paste/replace-block-at-parent';
import { ensureEditableContainers, normalizeReplacementTrivia } from '../../tree-operations';
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
	// block in its own slot. An empty insertion has nothing to stand there and takes the delete.
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

	// `updateContent`, not `input`: symmetric with the single-block path's KIND-CHANGING branch
	// (block-edit.ts updateBlockContent). Only that path's kind-stable branch emits the debounced
	// `input`, which consumers read as "kind held" (components/lrd-map-gate.ts runs post-commit
	// and cannot recover a destroyed kind). snapshot: 'skip' keeps the char in the delete's unit.
	const scope = resolveTypedCharScope(ctx, caret.path);
	if (!scope) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return;
	}

	// resolveTypedCharScope returns the leaf's IMMEDIATE parent: every mounted container registers
	// a BlockListState, and the document root stands in for a top-level leaf. The guard below is
	// the enforcement belt — an unregistered ancestor would make `scope` a grandparent and splice
	// the wrong slot, so that case degrades to a raw-only splice instead.
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
				// Degraded, but still a body write: this arm splices raw with no reparse, so the
				// container's rule and the leaf's own are all that stand between a typed `>` or
				// backtick and a terminator line.
				writeOwnRaw(
					owned,
					normalizeBodyWrite(
						chain[chain.length - 2]?.kind,
						owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset)
					),
					ctx.grammar
				);
				rebuildUnsharedChain(doc, chain, sharing, null, ctx.grammar);
				return [{ op: 'noop' }];
			}

			// Re-parse the spliced leaf inside the commit so a marker at offset 0 re-derives the
			// kind (updateNodeContent mints a fresh node on a kind change). A single character
			// never introduces a blank line, so the multi-block replacement arm is unreachable.
			const owned = ensureUnsharedChild(scopeView.node, leafIndex, sharing);
			const newText = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
			settled = updateNodeContent(
				{ children: scopeView.children, ownerKind: scopeView.node.kind, owner: scopeView.node },
				leafIndex,
				newText,
				ctx.grammar,
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
			// A settle that absorbed the join above left the predecessor holding the typed bytes,
			// so the leaf slot the delete resolved is no longer where the caret belongs.
			const siblings = scopeChildrenOf(ctx, scope.path);
			const target = settledCaretTarget(settled, leafIndex, caret.offset + typed.length, siblings);
			const path = [...caret.path.slice(0, -1), target.index];
			// The reveal above mounted the slot the delete resolved; a fold can land the caret on
			// one the render window never held.
			if (target.index !== leafIndex) await ctx.revealPath(path);
			focusCollapsedCaret(ctx.getBlockElByPath, { path, offset: target.offset });
		}
	});
}

/**
 * Replace the covered block with the parse of the typed character, at the block's parent
 * position: the same door the covered-block paste takes, so both gestures splice at one scope
 * and land one undo entry. Re-parsed rather than spliced, so a marker typed over the block
 * derives its kind exactly as the single-block type path does.
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
	// Terminated in the block's OWN ending: an unterminated line leaves the block below flowing
	// into the one the character just minted (G4.20).
	const parsed = parse(terminateLine(typed, covered.raw), {
		grammar: ctx.grammar,
		scope: 'fragment'
	});
	if (parsed.children.length === 0) return;

	const replacement = normalizeReplacementTrivia(covered, parsed.children);
	for (const node of replacement) ensureEditableContainers(node);

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await replaceBlockAtParent({
		doc,
		blockPath,
		replacement,
		controller: ctx.pasteCoordinator,
		undoEntry: 'join',
		focusReplacementIndex: replacement.length - 1,
		focusOffset: CURSOR_END,
		source: 'cross-block-covered-block',
		...(ctx.grammar ? { grammar: ctx.grammar } : {})
	});
}

/** The scope's children, re-read after the commit: the ceremony replaces the node it published. */
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

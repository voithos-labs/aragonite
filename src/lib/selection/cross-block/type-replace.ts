/**
 * Cross-block type-replace: the user typed a character with a cross-block selection active.
 * Delete the range, splice the character into the surviving leaf's raw, re-parse so a marker at
 * offset 0 re-derives the kind (parity with the single-block type path). Routed through
 * commitMultiScope so a kind change mints a fresh node, ids/refs stay synced, and the op is
 * `updateContent`.
 */

import type { MultiScopeTarget } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import {
	blockNodeAt,
	normalizeBodyWrite,
	updateNodeContent,
	writeOwnRaw
} from '../../tree-operations/node-ops';
import { focusCollapsedCaret } from '../native-bridge';
import {
	ensureUnsharedChild,
	ensureUnsharedNode,
	ensureUnsharedPath,
	rebuildUnsharedChain
} from '../../tree-operations/unshare';
import { stampStructuralChange } from '../../tree-operations/structural-change';
import { getStateForNode } from '../../reactivity/state-registry';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { devWarn } from '../../dev-warn';

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
	// All caret placements below target caret.path's top-level block; mount it once here so each
	// (the post-tick landing included) finds a live element.
	await ctx.revealPath(caret.path);
	if (!typed) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return true;
	}

	const doc = ctx.getDoc();
	const targetNode = blockNodeAt(doc, caret.path);
	if (!targetNode) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return true;
	}

	// `updateContent`, not `input`: symmetric with the single-block path's KIND-CHANGING branch
	// (block-edit.ts updateBlockContent). Only that path's kind-stable branch emits the debounced
	// `input`, which consumers read as "kind held" (components/lrd-map-gate.ts runs post-commit
	// and cannot recover a destroyed kind). snapshot: 'skip' keeps the char in the delete's unit.
	const scope = resolveTypedCharScope(ctx, caret.path);
	if (!scope) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return true;
	}

	// resolveTypedCharScope returns the leaf's IMMEDIATE parent: every mounted container registers
	// a BlockListState, and the document root stands in for a top-level leaf. The guard below is
	// the enforcement belt — an unregistered ancestor would make `scope` a grandparent and splice
	// the wrong slot, so that case degrades to a raw-only splice instead.
	const leafIndex = caret.path[caret.path.length - 1];
	const scopeIsImmediateParent = scope.path.length === caret.path.length - 1;

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
				rebuildUnsharedChain(doc, chain, sharing, ctx.grammar);
				return [{ op: 'noop' }];
			}

			// Re-parse the spliced leaf inside the commit so a marker at offset 0 re-derives the
			// kind (updateNodeContent mints a fresh node on a kind change). A single character
			// never introduces a blank line, so the multi-block replacement arm is unreachable.
			const owned = ensureUnsharedChild(scopeView.node, leafIndex, sharing);
			const newText = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
			const change = updateNodeContent(
				{ children: scopeView.children, ownerKind: scopeView.node.kind },
				leafIndex,
				newText,
				ctx.grammar
			);
			stampStructuralChange(scopeView.children, change, sharing);
			return [change];
		},
		op: {
			kind: 'updateContent',
			// `op` is evaluated ahead of `mutate` and the splice only inserts, so the post-commit
			// length is already fixed. Read for the event detail alone.
			detail: { length: targetNode.raw.length + typed.length },
			eventPath: docPathFrom(caret.path)
		},
		afterTick: () => {
			focusCollapsedCaret(ctx.getBlockElByPath, {
				path: caret.path,
				offset: caret.offset + typed.length
			});
		}
	});
	return true;
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

/**
 * Cross-block type-replace: the user typed a character with a cross-block
 * selection active. Delete the range, splice the typed character into the
 * surviving leaf's raw, and re-parse it so a marker at offset 0 re-derives the
 * kind (parity with the single-block type path). Routed through commitMultiScope
 * so the mutation matches the single-block update path — a kind change mints a
 * fresh node into the slot, ids/refs stay synced, op:'updateContent' is emitted.
 */

import type { MultiScopeTarget } from '../../action-contracts';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { blockNodeAt, updateNodeContent } from '../../tree-operations/node-ops';
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
	// All caret placements below target caret.path's top-level block; mount it
	// once here so each (including the non-awaited afterTick) finds a live element.
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

	// Route the splice through commitMultiScope so the mutation lands inside the
	// commit primitive: parallel ids/refs reactivity contract honored, and the op
	// is `updateContent` — symmetric with the single-block path's KIND-CHANGING
	// branch (block-edit.ts updateBlockContent), the partner for a write that
	// re-derives the kind. Only that path's kind-stable branch emits the debounced
	// `input`, and consumers read `input` as "kind held" (components/lrd-map-gate.ts
	// runs post-commit and cannot recover a destroyed kind any other way).
	// snapshot: 'skip' keeps the typed character in the same undo unit as
	// performCrossBlockDelete.
	const scope = resolveTypedCharScope(ctx, caret.path);
	if (!scope) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return true;
	}

	// resolveTypedCharScope returns the leaf's IMMEDIATE parent — every mounted
	// container registers a BlockListState, so the deepest-registered ancestor is
	// the parent, and the document root stands in for a top-level leaf (scope path
	// []). The re-parse-and-replace below therefore lands in the scope's own
	// children and its StructuralChange syncs the scope's ids/refs. The guard is
	// the enforcement belt: an unregistered ancestor would make `scope` a
	// grandparent, and the replace would splice the wrong slot — degrade to the
	// raw-only splice rather than corrupt — non-corrupting, though a nested fallback
	// leaves a stale kind and a dev-visible stale-raw fire until the next reparse.
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
				owned.raw = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
				rebuildUnsharedChain(chain, sharing);
				return [{ op: 'noop' }];
			}

			// Re-parse the spliced leaf inside the commit so a marker at offset 0
			// re-derives the kind — parity with the single-block type path
			// (updateNodeContent mints a fresh node on a kind change, writes fields
			// in place otherwise). A single typed character never introduces a blank
			// line, so the multi-block replacement arm is unreachable: the survivor
			// stays one slot and afterTick restores one caret.
			const owned = ensureUnsharedChild(scopeView.node, leafIndex, sharing);
			const newText = owned.raw.slice(0, charOffset) + typed + owned.raw.slice(charOffset);
			const change = updateNodeContent(
				{ children: scopeView.children },
				leafIndex,
				newText,
				ctx.grammar
			);
			stampStructuralChange(scopeView.children, change, sharing);
			return [change];
		},
		op: {
			kind: 'updateContent',
			// `op` is evaluated ahead of `mutate`, and the splice only inserts, so
			// the post-commit length is already fixed. Read for the event detail
			// alone — the mutation still derives its bytes from the owned copy.
			detail: { length: targetNode.raw.length + typed.length },
			eventPath: docPathFrom(caret.path)
		},
		afterTick: () =>
			focusCollapsedCaret(ctx.getBlockElByPath, {
				path: caret.path,
				offset: caret.offset + typed.length
			})
	});
	return true;
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

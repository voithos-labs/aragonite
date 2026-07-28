// Driving `cross-block/keydown.ts` as a unit.
//
// The dispatcher is the entry layer for every key that arrives while a cross-block
// range is live, and it had exactly one test — four sticky-column outcomes. Its arms
// (destructive, command-candidate, extend, collapse, doc-edge, select-all) are
// module-private, so the only way in is `createCrossBlockKeydown`.
//
// The mutation context is REAL — a live document, undo controller and selection —
// rather than a cast stub, so a destructive arm's assertion reads the document's
// bytes and a reading-mode gate is proven by the bytes NOT moving. That distinction
// is the whole point of the gate, and a spy cannot make it.

import { vi } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import type { PresentationMode } from '$lib/presentation-mode';
import type { CrossBlockDispatchContext } from '$lib/selection/cross-block/dispatch';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/ops';
import { createCrossBlockKeydown } from '$lib/selection/cross-block/keydown';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createStickyColumnState } from '$lib/cursor/sticky-column';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { makeEditorActionsDeps } from '../../harness/editor-actions';

export interface KeydownEnvOptions {
	presentationMode?: PresentationMode;
	/** Component the reveal resolves to — the post-delete command dispatch target. */
	revealTo?: BlockComponent | null;
	myPath?: number[];
}

export function makeKeydownEnv(source: string, opts: KeydownEnvOptions = {}) {
	// The extend arms scroll the moved endpoint into view; jsdom has no layout.
	Element.prototype.scrollIntoView = () => {};
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const selection = harness.deps.selectionState;
	const stickyColumn = createStickyColumnState();

	// One element per path: the extend walk reads element identity, never geometry.
	const blockEls = new Map<string, HTMLElement>();
	const getBlockElByPath = (path: number[]): HTMLElement => {
		const key = JSON.stringify(path);
		if (!blockEls.has(key)) blockEls.set(key, document.createElement('div'));
		return blockEls.get(key)!;
	};

	const revealed: number[][] = [];
	const revealPath = vi.fn(async (path: number[]) => {
		revealed.push(path.slice());
		return opts.revealTo ?? null;
	});

	const mutCtx: CrossBlockMutationContext = {
		selection,
		getDoc: () => harness.deps.doc,
		getBlockElByPath,
		revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
		grammar: undefined
	};

	const onCommandError = vi.fn();
	const ctx = {
		getEl: () => getBlockElByPath(opts.myPath ?? [0]),
		getMyPath: () => opts.myPath ?? [0],
		getIndex: () => 0,
		selection,
		getDoc: () => harness.deps.doc,
		getBlockElByPath,
		revealPath,
		stickyColumn,
		controller,
		history: { requestUndo: vi.fn(), requestRedo: vi.fn() },
		pluginEditor: undefined,
		getPresentationMode: opts.presentationMode ? () => opts.presentationMode! : undefined,
		onCommandError,
		getKeybindingOverrides: () => ({ global: new Map(), byKind: new Map() }),
		afterReactivity: async () => {}
	} as unknown as CrossBlockDispatchContext;

	return {
		...harness,
		selection,
		stickyColumn,
		controller,
		ctx,
		mutCtx,
		revealed,
		revealPath,
		onCommandError,
		keydown: createCrossBlockKeydown(ctx, mutCtx),
		source: () => serialize(harness.deps.doc)
	};
}

export function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

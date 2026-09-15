// Drives `cross-block/keydown.ts` as a unit. Its branches (destructive, command-candidate, extend,
// collapse, document-edge, select-all) are module-private, so the only way in is
// `createCrossBlockKeydown`. The mutation context is real (live document, undo controller and
// selection), so a reading-mode check is proven by the bytes not moving, which a spy cannot do.

import { vi } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import type { PresentationMode } from '$lib/presentation-mode';
import type { CrossBlockDispatchContext } from '$lib/selection/cross-block/dispatch';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/ops';
import { createCrossBlockKeydown } from '$lib/selection/cross-block/keydown';
import { createCrossBlockCommands } from '$lib/selection/cross-block/format-toggle';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createEdgeAffinityState } from '$lib/cursor/edge-affinity';
import { createStickyColumnState } from '$lib/cursor/sticky-column';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { installEditorDomStubsForTests } from '$lib/testing';
import { makeEditorActionsDeps } from '../../harness/editor-actions';

export interface KeydownEnvOptions {
	presentationMode?: PresentationMode;
	/** The component the mount resolves to, the post-delete command dispatch target. */
	revealTo?: BlockComponent | null;
	myPath?: number[];
	/**
	 * Paths that are windowed out: `getBlockElByPath` reports null for them until a mount brings
	 * them in, the only way to reach the caret-placing branch of `revealActiveEndpoint`.
	 */
	offWindowPaths?: number[][];
}

export function makeKeydownEnv(source: string | Document, opts: KeydownEnvOptions = {}) {
	// The extend branches scroll the moved endpoint into view; jsdom has no layout.
	installEditorDomStubsForTests();
	const harness = makeEditorActionsDeps(typeof source === 'string' ? parse(source) : source);
	const controller = createUndoController(harness.deps);
	const selection = harness.deps.selectionState;
	const stickyColumn = createStickyColumnState();
	const edgeAffinity = createEdgeAffinityState();

	// One element per path: the extend walk reads element identity, never geometry.
	const blockEls = new Map<string, HTMLElement>();
	const offWindow = new Set((opts.offWindowPaths ?? []).map((path) => JSON.stringify(path)));
	const getBlockElByPath = (path: number[]): HTMLElement | null => {
		const key = JSON.stringify(path);
		if (offWindow.has(key)) return null;
		if (!blockEls.has(key)) blockEls.set(key, document.createElement('div'));
		return blockEls.get(key)!;
	};

	const revealed: number[][] = [];
	const revealPath = vi.fn(async (path: number[]) => {
		revealed.push(path.slice());
		// A mount brings in what it scrolled to, so the path stops being windowed out, which is
		// what lets the scroll after the caret placement be observed at all.
		offWindow.delete(JSON.stringify(path));
		return opts.revealTo ?? null;
	});

	const mutCtx: CrossBlockMutationContext = {
		selection,
		getDoc: () => harness.deps.doc,
		getBlockElByPath,
		revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
		grammar: undefined,
		getPresentationMode: undefined,
		linkRef: undefined
	};

	const getPresentationMode = opts.presentationMode ? () => opts.presentationMode! : undefined;
	// The real handler, so a format chord over a range moves the bytes it would move in production.
	const crossBlockCommands = createCrossBlockCommands({
		selection,
		getDoc: () => harness.deps.doc,
		getBlockElByPath,
		revealPath,
		controller,
		getPresentationMode,
		grammar: undefined,
		getContentVersion: harness.contentVersion
	});

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
		edgeAffinity,
		controller,
		history: { requestUndo: vi.fn(), requestRedo: vi.fn() },
		pluginEditor: undefined,
		getPresentationMode,
		onCommandError,
		crossBlockCommands,
		getKeybindingOverrides: () => ({ global: new Map(), byKind: new Map() }),
		afterReactivity: async () => {}
	} as unknown as CrossBlockDispatchContext;

	return {
		...harness,
		selection,
		stickyColumn,
		edgeAffinity,
		controller,
		ctx,
		mutCtx,
		revealed,
		revealPath,
		crossBlockCommands,
		onCommandError,
		keydown: createCrossBlockKeydown(ctx, mutCtx),
		source: () => serialize(harness.deps.doc)
	};
}

export function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

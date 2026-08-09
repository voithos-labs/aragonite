// @vitest-environment jsdom
//
// The defensive branch in handleCrossBlockPaste that consumes the event and inserts nothing.
// Reachable through the delete's own re-entrancy serialization: a paste arriving while a delete is
// parked on its reveal waits it out, and the delete collapses the selection on its way through.
import { describe, it, expect } from 'vitest';
import { createCrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import { performCrossBlockDelete } from '$lib/selection/cross-block/ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	makeEditorActionsDeps,
	makeStickyColumn,
	makeEdgeAffinity
} from '$lib/test/harness/editor-actions';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { EditorError } from '$lib/editor-events';
import type { BlockComponent } from '$lib/block-component';

const SOURCE = 'para A\n\npara B\n\npara C\n';

/** `revealPath` is gated so a delete can be held mid-flight, the window a second
 *  cross-block gesture arrives in. */
function makeEnv() {
	const harness = makeEditorActionsDeps(parse(SOURCE).children);
	const controller = createUndoController(harness.deps);
	const blockEdit = createBlockEditActions(harness.deps, controller);
	const stickyColumn = makeStickyColumn();
	const edgeAffinity = makeEdgeAffinity();

	let release!: () => void;
	const gate = new Promise<BlockComponent | null>((resolve) => {
		release = () => resolve(null);
	});
	let gateArmed = true;

	const errors: EditorError[] = [];
	harness.events.on('error', (e) => errors.push(e));

	const handlers = createCrossBlockHandlers({
		getEl: () => document.createElement('div'),
		getMyPath: () => [0],
		getIndex: () => 0,
		selection: harness.deps.selectionState,
		getDoc: () => harness.deps.doc,
		getBlockElByPath: () => null,
		revealPath: (path) => (gateArmed ? gate : harness.deps.revealPath(path)),
		getEditorRoot: () => null,
		getScrollHost: () => null,
		getEditorLifetime: () => null,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		onCommandError: undefined,
		getKeybindingOverrides: () => normalizeKeybindingOverrides(undefined),
		pasteCoordinator: createPasteCoordinator(controller, harness.deps.revealPath),
		grammar: undefined,
		events: harness.events,
		getCursorOffset: () => 0,
		afterReactivity: async () => {}
	});

	return {
		...harness,
		controller,
		handlers,
		errors,
		stickyColumn,
		edgeAffinity,
		mutCtx: {
			selection: harness.deps.selectionState,
			getDoc: () => harness.deps.doc,
			getBlockElByPath: () => null,
			revealPath: () => gate,
			controller,
			pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
			grammar: undefined,
			getPresentationMode: undefined
		},
		releaseReveal: () => {
			gateArmed = false;
			release();
		}
	};
}

function pasteEvent(text: string): ClipboardEvent {
	return {
		clipboardData: { getData: () => text },
		preventDefault: () => {}
	} as unknown as ClipboardEvent;
}

describe('a cross-block paste whose delete resolves no caret', () => {
	it('reports on the error channel instead of dropping the payload silently', async () => {
		const env = makeEnv();
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		// The delete parks on its reveal; the paste arrives while the selection is
		// still cross-block, so it passes every guard on the way in.
		const deleting = performCrossBlockDelete(env.mutCtx);
		const pasting = env.handlers.handlePaste(pasteEvent('DROPPED'));
		env.releaseReveal();

		expect(await pasting).toBe(true);
		await deleting;

		expect(serialize(env.deps.doc)).not.toContain('DROPPED');
		expect(env.errors.map((e) => e.origin)).toEqual(['clipboard']);
		expect(String((env.errors[0].error as Error).message)).toContain('no caret');
		// The range start, read before the delete collapsed the selection: a report naming nothing
		// would leave a host unable to say WHERE the paste it must compensate for was aimed.
		expect(env.errors[0].context?.path).toEqual([0]);
	});
});

// The empty-payload return commits nothing, so no commit ceremony runs to clear the ephemeral
// caret states behind it — the arm's own resets are the only ones on that path.
describe('a cross-block paste with an empty payload', () => {
	it('consumes the event and still clears the sticky column and the edge affinity', async () => {
		const env = makeEnv();
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		expect(await env.handlers.handlePaste(pasteEvent(''))).toBe(true);

		expect(serialize(env.deps.doc)).toBe(SOURCE);
		expect(env.stickyColumn.reset).toHaveBeenCalled();
		expect(env.edgeAffinity.reset).toHaveBeenCalled();
	});
});

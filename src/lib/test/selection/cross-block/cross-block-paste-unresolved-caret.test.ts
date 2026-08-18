// @vitest-environment jsdom
//
// The defensive branch in handleCrossBlockPaste that consumes the event and inserts nothing.
// Reachable through the delete's own re-entrancy serialization: a paste arriving while a delete is
// parked on its reveal waits it out, and the delete collapses the selection on its way through.
import { describe, it, expect } from 'vitest';
import {
	performCrossBlockDelete,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { serialize } from '$lib/core/serializer';
import type { EditorError } from '$lib/editor-events';
import type { BlockComponent } from '$lib/block-component';
import { makeEnv, makeHandlers, makePasteEvent } from './typed-char-env';

const SOURCE = 'para A\n\npara B\n\npara C\n';

/** `revealPath` is gated so a delete can be held mid-flight, the window a second
 *  cross-block gesture arrives in. */
function makeGatedEnv() {
	const env = makeEnv(SOURCE);
	let release!: () => void;
	const gate = new Promise<BlockComponent | null>((resolve) => {
		release = () => resolve(null);
	});
	let gateArmed = true;

	const errors: EditorError[] = [];
	env.events.on('error', (e) => errors.push(e));

	const handlers = makeHandlers(env, [0], {
		revealPath: (path) => (gateArmed ? gate : env.deps.revealPath(path))
	});

	const mutCtx: CrossBlockMutationContext = {
		selection: env.selectionState,
		getDoc: () => env.doc,
		getBlockElByPath: () => null,
		revealPath: () => gate,
		controller: env.controller,
		pushUndoSnapshot: () => env.controller.pushUndoSnapshot(0, 0),
		grammar: undefined,
		getPresentationMode: undefined,
		linkRef: undefined
	};

	return {
		env,
		handlers,
		errors,
		mutCtx,
		releaseReveal: () => {
			gateArmed = false;
			release();
		}
	};
}

describe('a cross-block paste whose delete resolves no caret', () => {
	it('reports on the error channel instead of dropping the payload silently', async () => {
		const { env, handlers, errors, mutCtx, releaseReveal } = makeGatedEnv();
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		// The delete parks on its reveal; the paste arrives while the selection is
		// still cross-block, so it passes every guard on the way in.
		const deleting = performCrossBlockDelete(mutCtx);
		const pasting = handlers.handlePaste(makePasteEvent('DROPPED'));
		releaseReveal();

		expect(await pasting).toBe(true);
		await deleting;

		expect(serialize(env.doc)).not.toContain('DROPPED');
		expect(errors.map((e) => e.origin)).toEqual(['clipboard']);
		expect(String((errors[0].error as Error).message)).toContain('no caret');
		// The range start, read before the delete collapsed the selection: a report naming nothing
		// would leave a host unable to say WHERE the paste it must compensate for was aimed.
		expect(errors[0].context?.path).toEqual([0]);
	});
});

// The empty-payload return commits nothing, so no commit ceremony runs to clear the ephemeral
// caret states behind it — the arm's own resets are the only ones on that path.
describe('a cross-block paste with an empty payload', () => {
	it('consumes the event and still clears the sticky column and the edge affinity', async () => {
		const { env, handlers } = makeGatedEnv();
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		expect(await handlers.handlePaste(makePasteEvent(''))).toBe(true);

		expect(serialize(env.doc)).toBe(SOURCE);
		expect(env.stickyColumn.reset).toHaveBeenCalled();
		expect(env.edgeAffinity.reset).toHaveBeenCalled();
	});
});

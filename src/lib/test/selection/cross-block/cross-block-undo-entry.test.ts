// @vitest-environment jsdom
// A cross-block gesture is one undo entry holding the document and the range as they stood
// before it.
// Miss-analysis: each gesture's suite counted commits, and none read what the undo entry recorded.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import type { UndoEntry } from '$lib/undo/types';
import type { SelectionEndpoint, SelectionPoint } from '$lib/selection/primitives';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { stubBlockComponent } from '../../harness/editor-actions';
import { makeEnv, makeHandlers, makeBeforeInputEvent, makePasteEvent } from './typed-char-env';
import { makeKeydownEnv, press } from './keydown-env';
import { settleEditor } from '../../harness/settle';
import { makeSurface } from '../../harness/editable-surface';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';
const ANCHOR: SelectionPoint = { path: [0], offset: 2 };
const FOCUS: SelectionPoint = { path: [2], offset: 3 };
// `beta` held whole: the paste and the typed character replace the block in its position.
const WHOLE: SelectionEndpoint = { path: [1], wholeBlock: true };
const COVERED_ANCHOR: SelectionPoint = { path: [1], offset: 0 };
const COVERED_FOCUS: SelectionPoint = { path: [1], offset: 4 };

type Env = ReturnType<typeof makeEnv>;

function onlyEntry(undo: UndoEntry[]): UndoEntry {
	expect(undo).toHaveLength(1);
	return undo[0];
}

function expectStateBefore(entry: UndoEntry, anchor: SelectionPoint, focus: SelectionPoint) {
	expect(serialize(entry.snapshot)).toBe(SOURCE);
	expect(entry.selection).toEqual({ anchor, focus });
}

describe('a cross-block gesture is one undo entry holding the state before it', () => {
	const gestures = [
		['paste over a range', ANCHOR, FOCUS, false, 'paste'],
		['paste over a block held whole', COVERED_ANCHOR, COVERED_FOCUS, true, 'paste'],
		['typing over a range', ANCHOR, FOCUS, false, 'type'],
		['typing over a block held whole', COVERED_ANCHOR, COVERED_FOCUS, true, 'type']
	] as const;

	for (const [name, anchor, focus, whole, gesture] of gestures) {
		it(name, async () => {
			const env = makeEnv(SOURCE);
			if (whole) env.selectionState.enterCrossBlock(WHOLE, WHOLE);
			else env.selectionState.enterCrossBlock(anchor, focus);
			const handlers = makeHandlers(env, [0]);

			if (gesture === 'paste') await handlers.handlePaste(makePasteEvent('X'));
			else await handlers.handleBeforeInput(makeBeforeInputEvent('X'));

			expect(serialize(env.doc)).not.toBe(SOURCE);
			expectStateBefore(onlyEntry(env.deps.undoManager.getStacks().undo), anchor, focus);
		});
	}

	// Miss-analysis: the composition's suites composed inside one block, where no removal ran first.
	it('a composition over a range: the removal and the composed text are one entry', async () => {
		const env = makeEnv(SOURCE);
		env.selectionState.enterCrossBlock(ANCHOR, FOCUS);
		makeHandlers(env, [0]).handleCompositionStart();
		await settleEditor();

		// The composed text arrives as the block's own typing write.
		await env.blockEdit.updateBlockContent(0, 'alかんma\n', 'authored', 2, 4);

		expect(serialize(env.doc)).toBe('alかんma\n');
		expectStateBefore(onlyEntry(env.deps.undoManager.getStacks().undo), ANCHOR, FOCUS);
	});

	// Miss-analysis: the composition row always typed its text next, so no test ended the
	// composition with nothing written and saw the removal's entry take the next, unrelated write.
	describe('a composition that writes nothing leaves the next typing its own entry', () => {
		const FOUR = 'alpha\n\nbeta\n\ngamma\n\ndelta\n';

		/** The block the IME composes in, its element gone by compositionend, so nothing is written. */
		async function composeNothing(env: Env): Promise<void> {
			let el: HTMLElement | null = document.createElement('div');
			const { surface } = makeSurface({
				blockEdit: env.blockEdit,
				overrides: {
					getEl: () => el,
					selection: env.selectionState,
					controller: env.controller,
					getDoc: () => env.doc,
					caretLanding: env.deps.caretLanding,
					caretMemory: env.caretMemory,
					events: env.events,
					reading: env.deps.reading,
					pasteCoordinator: createPasteCoordinator(env.deps, env.controller),
					activePlugins: everyInstalledPlugin
				}
			});
			surface.onCompositionStart();
			await settleEditor();
			el = null;
			surface.onCompositionEnd();
		}

		const typing = [
			['typing in the same block', composeNothing, 0, 'alxma\n', 2, 3],
			['typing in another block', composeNothing, 1, 'deltax\n', 5, 6],
			[
				'typing after the batch ends, before compositionend',
				async (env: Env) => {
					makeHandlers(env, [0]).handleCompositionStart();
					await settleEditor();
					env.controller.flushDebouncedCheckpoint();
				},
				0,
				'alxma\n',
				2,
				3
			]
		] as const;

		for (const [name, compose, index, text, before, after] of typing) {
			it(name, async () => {
				const env = makeEnv(FOUR);
				env.selectionState.enterCrossBlock(ANCHOR, FOCUS);
				await compose(env);

				await env.blockEdit.updateBlockContent(index, text, 'authored', before, after);

				expect(env.deps.undoManager.getStacks().undo).toHaveLength(2);
			});
		}
	});

	it('Enter over a range: the delete and the split are one entry', async () => {
		const env = makeKeydownEnv(SOURCE);
		const blockEdit = createBlockEditActions(env.deps, env.controller);
		const split = stubBlockComponent({
			runCommand: (id) => (id === 'block.split' ? (void blockEdit.splitBlock(0, 2), true) : false)
		});
		env.revealPath.mockResolvedValue(split);
		env.selection.enterCrossBlock(ANCHOR, FOCUS);

		await env.keydown.handleKeyDown(press('Enter'));

		expect(env.source()).toBe('al\n\nma\n');
		expectStateBefore(onlyEntry(env.deps.undoManager.getStacks().undo), ANCHOR, FOCUS);
	});
});

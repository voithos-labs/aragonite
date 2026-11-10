// @vitest-environment jsdom
// The two branches that run while cross-block mode is not yet active, plus compositionstart.
// Ctrl+A escalates over two presses counted on `SelectionState`, so a press that forgot to count
// leaves it stuck at one block; compositionstart has no beforeinput to wait for, so an active range
// must be deleted synchronously or composed text lands on a stale one.
import { describe, it, expect } from 'vitest';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { takeDevWarns } from '../../support/warn-gate';
import { fingerPress } from '#lib/selection/pointer-gesture.js';
import { makeKeydownEnv, press } from './keydown-env';
import { createCrossBlockKeydown } from '#lib/selection/cross-block/keydown.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { widgetSpanAt } from '#lib/components/blocks/text/widget-adjacency.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { stubBlockComponent } from '#lib/test/harness/editor-actions.js';
import { settleEditor } from '#lib/test/harness/settle.js';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

describe('cross-block keydown: Ctrl+A priority order', () => {
	it('first press selects within the block, without entering cross-block mode', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.selectAllCount).toBe(1);
		expect(env.selection.ownsRange).toBe(false);
	});

	it('second press escalates to the whole document', async () => {
		const env = makeKeydownEnv(SOURCE);

		await env.keydown.handleKeyDown(press('a', { ctrlKey: true }));
		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.ownsRange).toBe(true);
		expect(env.selection.anchor?.path).toEqual([0]);
		expect(env.selection.focus?.path).toEqual([2]);
	});

	// Miss-analysis: every press started from a caret in a block with text, where the first step
	// changes something; none started where it changes nothing.
	it('a first press over a block already all selected goes to the document', async () => {
		const env = makeKeydownEnv(SOURCE);
		const el = env.ctx.getEl()!;
		el.textContent = 'alpha';
		document.body.append(el);
		document.getSelection()!.setBaseAndExtent(el.firstChild!, 5, el.firstChild!, 0);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.ownsRange).toBe(true);
		expect(env.selection.focus?.path).toEqual([2]);
		el.remove();
	});

	// A finger's range is the editor's, not the browser's, so the check reads that one instead.
	it.each([
		{ held: 'a word', end: 3, focus: [0] },
		{ held: 'the whole block', end: 5, focus: [2] }
	])("a first press over a finger's range of $held", async ({ end, focus }) => {
		const env = makeKeydownEnv(SOURCE);
		const el = env.ctx.getEl()!;
		el.textContent = 'alpha';
		document.body.append(el);
		const finger = fingerPress({ pointerType: 'touch', pointerId: 1 })!;
		env.selection.ownBlockRange({ path: [0], offset: 0 }, { path: [0], offset: end }, finger);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.focus?.path ?? [0]).toEqual(focus);
		el.remove();
	});

	it('re-selects the whole document when pressed with a range already active', async () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.focus?.path).toEqual([2]);
	});

	// Ctrl+Shift+A is a different chord and must not count as a second press.
	it('ignores the shifted chord', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true, shiftKey: true }))).toBe(
			false
		);

		expect(env.selection.selectAllCount).toBe(0);
	});
});

describe('cross-block keydown: compositionstart', () => {
	it('deletes the active range synchronously and reports it handled', () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(env.keydown.handleCompositionStart()).toBe(true);

		expect(env.source()).toBe('ata\n\ngamma\n');
		expect(env.selection.ownsRange).toBe(false);
	});

	it('declines with no range active, leaving the composition to the block', () => {
		const env = makeKeydownEnv(SOURCE);

		expect(env.keydown.handleCompositionStart()).toBe(false);

		expect(env.source()).toBe(SOURCE);
	});

	// Miss-analysis: every compositionstart row held a range or nothing, so none started over a
	// selected widget, where the composition ran beside it and left it selected.
	describe('over a widget selected whole', () => {
		const WIDGET = 'a ![x](u) b\n\nnext\n';

		/** The env's keydown over a selection that reads a widget's span, as the editor's does; the
		 *  undo controller reads the same one. */
		function held(sourceStart: number, myPath = [0]) {
			const env = makeKeydownEnv(WIDGET);
			const selection = createSelectionState({
				getDoc: () => env.deps.doc,
				widgetSpan: (target) => widgetSpanAt(env.deps.doc, target, env.ctx.reading)
			});
			Object.assign(env.deps, { selectionState: selection });
			const target = { paragraphPath: [0], sourceStart, preSelectOffset: sourceStart };
			selectWidgetWhole(selection, testCaretWriter, target, () => null);
			const ctx = { ...env.ctx, selection, getMyPath: () => myPath };
			return { env, selection, keydown: createCrossBlockKeydown(ctx) };
		}

		it('removes the widget’s bytes before it returns, ends it, and reports it handled', () => {
			const { env, selection, keydown } = held(2);

			expect(keydown.handleCompositionStart()).toBe(true);

			expect(env.source()).toBe('a  b\n\nnext\n');
			expect(selection.widget).toBeNull();
		});

		it('the undo entry records the widget’s caret, whatever caret its block reports', async () => {
			const { env, keydown } = held(2);
			env.deps.blockRefs[0] = stubBlockComponent({ getCursorOffset: () => 0 });

			keydown.handleCompositionStart();
			await settleEditor();

			const at = { path: [0], offset: 2 };
			expect(env.deps.undoManager.getStacks().undo.at(-1)!.selection).toEqual({
				anchor: at,
				focus: at
			});
		});

		it('ends a widget whose bytes are already gone, and writes nothing', () => {
			const { env, selection, keydown } = held(0);

			expect(keydown.handleCompositionStart()).toBe(true);

			expect(env.source()).toBe(WIDGET);
			expect(selection.widget).toBeNull();
		});

		it('leaves a widget selected in another block alone', () => {
			const { env, selection, keydown } = held(2, [1]);

			expect(keydown.handleCompositionStart()).toBe(false);

			expect(env.source()).toBe(WIDGET);
			expect(selection.widget).not.toBeNull();
		});
	});

	// Miss-analysis: only the arm's own reading-mode check was tested, never the delete's refusal.
	it('forced in reading mode, where nothing can compose, deletes nothing and warns', () => {
		const env = makeKeydownEnv(SOURCE, { presentationMode: 'reading' });
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		env.keydown.handleCompositionStart();

		expect(env.source()).toBe(SOURCE);
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});

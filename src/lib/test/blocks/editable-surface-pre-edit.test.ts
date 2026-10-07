// @vitest-environment jsdom
// An input commit's undo entry restores the caret read at `beforeinput`, the one event every
// input route fires: a keystroke, an IME commit, dictation, a soft keyboard.
// Miss-analysis: every undo-caret test typed through keydown, never an input with no keydown.
import { describe, it, expect, afterEach } from 'vitest';
import { makeSurface } from '../harness/editable-surface';

const insertText = (data: string) =>
	new InputEvent('beforeinput', { inputType: 'insertText', data });

afterEach(() => {
	document.body.innerHTML = '';
});

describe('editable surface: the pre-edit caret', () => {
	it('is the caret at beforeinput, not the one the input leaves', () => {
		const { surface, commits, el, setCaret } = makeSurface();
		el.textContent = 'abc tail';
		setCaret(3);
		surface.onBeforeInput(insertText('xyz'));
		setCaret(6);
		el.textContent = 'abcxyz tail';
		surface.onInput();

		expect(commits).toEqual([{ text: 'abcxyz tail', preEdit: 3, saved: 6 }]);
	});

	it('runs the block beforeinput handling after reading the caret', () => {
		const seen: Array<[string | null, number]> = [];
		const harness = makeSurface({
			handleBeforeInput: (e) => seen.push([e.data, harness.surface.getPreEditOffset()])
		});
		harness.setCaret(4);
		harness.surface.onBeforeInput(insertText('q'));

		expect(seen).toEqual([['q', 4]]);
	});

	// A key the block writes for itself fires no beforeinput, and a toolbar command fires no key.
	it('is the caret at keydown, for a key the block writes itself', async () => {
		const harness = makeSurface({
			handleKeydown: async () => {
				harness.setCaret(9);
				void harness.surface.writeText({
					text: 'written',
					caretAfter: 9,
					intent: 'typed',
					mode: 'authored',
					source: 'key'
				});
			}
		});
		harness.setCaret(4);
		harness.surface.onKeyDown(new KeyboardEvent('keydown', { key: 'x' }));
		await Promise.resolve();

		expect(harness.commits.map((c) => c.preEdit)).toEqual([4]);
	});

	it('is the caret a command found when it ran', () => {
		const { surface, commits, setCaret } = makeSurface();
		const run = surface.command(() =>
			surface.writeText({
				text: 'tab',
				caretAfter: 3,
				intent: 'typed',
				mode: 'authored',
				source: 'command'
			})
		);
		setCaret(2);
		void run();

		expect(commits.map((c) => c.preEdit)).toEqual([2]);
	});

	it('takes an anchor the block names for an edit it splices itself', () => {
		const { surface, commits, el, setCaret } = makeSurface();
		setCaret(5);
		surface.onBeforeInput(insertText('x'));
		surface.notePreEditOffset(2);
		el.textContent = 'ab';
		surface.onInput();

		expect(commits.map((c) => c.preEdit)).toEqual([2]);
	});
});

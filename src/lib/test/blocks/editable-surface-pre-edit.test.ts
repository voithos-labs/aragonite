// @vitest-environment jsdom
//
// Miss-analysis: every undo-caret test typed through keydown, which each block used to read the
// pre-edit caret on, so no test produced an input with no keydown before it.
import { describe, it, expect, afterEach } from 'vitest';
import { makeSurface } from '../harness/editable-surface';

// The caret an input commit's undo entry restores, read at `beforeinput`: the one event every
// input route fires, a keystroke, an IME commit, dictation and a soft keyboard alike.

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
		const harness = makeSurface(undefined, undefined, {
			handleBeforeInput: (e) => seen.push([e.data, harness.surface.getPreEditOffset()])
		});
		harness.setCaret(4);
		harness.surface.onBeforeInput(insertText('q'));

		expect(seen).toEqual([['q', 4]]);
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

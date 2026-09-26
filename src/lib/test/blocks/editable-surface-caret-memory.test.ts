// @vitest-environment jsdom
//
// Miss-analysis: the input commit's call was covered only by the lint that paired it with the
// column reset; with the lint gone nothing asserted what a typed byte leaves in the memory.
import { describe, it, expect, afterEach } from 'vitest';
import { makeSurface } from '../harness/editable-surface';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { asEditorX } from '$lib/cursor/coordinate-spaces';

afterEach(() => {
	document.body.innerHTML = '';
});

// Every input route (a keystroke, dictation, a soft keyboard) ends in the input commit, so the
// committed byte is what settles the caret memory, not the key that may or may not precede it.
describe('editable surface: an input commit settles the caret memory', () => {
	it('drops the column and the marks and records the near side', () => {
		const caretMemory = createCaretMemory();
		caretMemory.noteKey({ key: 'ArrowUp' }, null, () => asEditorX(240));
		caretMemory.pendingMarks.toggle('strong');
		const { surface, el } = makeSurface(undefined, undefined, { caretMemory });

		el.textContent = 'x';
		surface.onInput();

		expect(caretMemory.column()).toBeNull();
		expect(caretMemory.side()).toBe('near');
		expect(caretMemory.pendingMarks.get()).toBeNull();
	});
});

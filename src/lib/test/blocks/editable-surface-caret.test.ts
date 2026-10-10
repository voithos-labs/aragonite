// @vitest-environment jsdom
// The editable surface's caret: memory after an input, the pre-edit caret, the parkCaret
// clamp, and the pending restore.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { asEditorX } from '#lib/caret/coordinate-spaces.js';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { consumePendingRestore } from '../../components/blocks/editable-surface';

describe('caret memory', () => {
	// Miss-analysis: only a source lint covered the input commit's reset, never a typed byte.

	afterEach(() => {
		document.body.innerHTML = '';
	});

	// Every input route (a keystroke, dictation, a soft keyboard) ends in the input commit, so the
	// committed byte is what resets the caret memory, not the key that may or may not precede it.
	describe('editable surface: an input commit settles the caret memory', () => {
		it('drops the column, the marks and the edge record', () => {
			const caretMemory = createCaretMemory();
			caretMemory.noteKey({ key: 'ArrowUp' }, null, () => asEditorX(240));
			caretMemory.noteOutside();
			caretMemory.pendingMarks.toggle('strong');
			const { surface, el } = makeSurface({ caretMemory });

			el.textContent = 'x';
			surface.onInput(new InputEvent('input'));

			expect(caretMemory.column()).toBeNull();
			expect(caretMemory.side()).toBeNull();
			expect(caretMemory.pendingMarks.get()).toBeNull();
		});
	});
});

describe('pre-edit caret', () => {
	// An input commit's undo entry restores the caret read at `beforeinput`, which every input route fires.
	// Miss-analysis: every undo-caret test typed through keydown, never an input with no keydown.

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
			surface.onInput(new InputEvent('input'));

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
			surface.onInput(new InputEvent('input'));

			expect(commits.map((c) => c.preEdit)).toEqual([2]);
		});
	});
});

describe('park caret', () => {
	// `parkCaret` clamps every offset into the reachable range; `CURSOR_EXACT_START` alone is exempt.
	// Miss-analysis: e2e covered the marker values per gesture, and no test tried a numeric offset.

	/** `**bold** tail`: a hidden leading run [0,2) and content out to 13, so [2,13) is reachable. */
	function mountBoldLead(mode?: string): SurfaceHarness {
		const harness = makeSurface({ presentationMode: mode });
		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.textContent = '**';
		const closer = marker.cloneNode(true);
		harness.el.append(marker, document.createTextNode('bold'), closer, ' tail');
		return harness;
	}

	beforeEach(() => {
		document.body.innerHTML = '';
	});

	describe('parkCaret: every offset clamps into the reachable range', () => {
		it('a numeric offset behind a hidden leading run puts the caret at the first reachable offset', () => {
			const harness = mountBoldLead('live');
			harness.surface.surface.parkCaret(0);
			expect(harness.seats).toEqual([2]);
		});

		it('a numeric offset inside the reachable range is untouched', () => {
			const harness = mountBoldLead('live');
			harness.surface.surface.parkCaret(4);
			expect(harness.seats).toEqual([4]);
		});

		it('the sentinels resolve to the reachable extremes', () => {
			const harness = mountBoldLead('live');
			harness.surface.surface.parkCaret(CURSOR_START);
			harness.surface.surface.parkCaret(CURSOR_END);
			expect(harness.seats).toEqual([2, 13]);
		});

		it('source mode is identity for the same offsets: the whole range is reachable', () => {
			const harness = mountBoldLead(undefined);
			harness.surface.surface.parkCaret(0);
			harness.surface.surface.parkCaret(4);
			harness.surface.surface.parkCaret(CURSOR_START);
			expect(harness.seats).toEqual([0, 4, 0]);
		});

		it('CURSOR_EXACT_START puts the caret raw byte 0 even behind a hidden run', () => {
			const harness = mountBoldLead('live');
			harness.surface.surface.parkCaret(CURSOR_EXACT_START);
			expect(harness.seats).toEqual([0]);
		});
	});
});

describe('pending restore', () => {
	// A pending caret set before a render must not be applied once focus
	// has left the block, or the restore drags the global selection back into it.
	describe('consumePendingRestore', () => {
		let el: HTMLDivElement;
		let other: HTMLDivElement;

		beforeEach(() => {
			el = document.createElement('div');
			el.tabIndex = 0;
			other = document.createElement('div');
			other.tabIndex = 0;
			document.body.append(el, other);
		});

		afterEach(() => {
			el.remove();
			other.remove();
		});

		it('applies and reports true while the element still holds focus', () => {
			el.focus();
			let applied: number | null = null;
			const result = consumePendingRestore(el, 7, (offset) => {
				applied = offset;
			});
			expect(result).toBe(true);
			expect(applied).toBe(7);
		});

		it('does not apply and reports false when focus has left the element', () => {
			other.focus();
			let ran = false;
			const result = consumePendingRestore(el, 7, () => {
				ran = true;
			});
			expect(result).toBe(false);
			expect(ran).toBe(false);
		});

		it('is a no-op when there is no pending value', () => {
			el.focus();
			let ran = false;
			const result = consumePendingRestore(el, null, () => {
				ran = true;
			});
			expect(result).toBe(false);
			expect(ran).toBe(false);
		});

		it('reports false for a null element (unmounted surface)', () => {
			let ran = false;
			const result = consumePendingRestore(null, 3, () => {
				ran = true;
			});
			expect(result).toBe(false);
			expect(ran).toBe(false);
		});

		it('carries any pending shape: a range for the code wrap branch', () => {
			el.focus();
			let applied: { start: number; end: number } | null = null;
			const result = consumePendingRestore(el, { start: 2, end: 5 }, (range) => {
				applied = range;
			});
			expect(result).toBe(true);
			expect(applied).toEqual({ start: 2, end: 5 });
		});
	});
});

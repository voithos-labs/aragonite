// @vitest-environment jsdom
// Miss-analysis: no route decided a collapsed delete at `beforeinput`, so nothing pinned which ones
// the editor writes and which it hands back to the browser.
import { describe, expect, it } from 'vitest';
import {
	decideCollapsedDelete,
	decideDeleteChord,
	type CollapsedDeleteReads
} from '#lib/components/blocks/editable/collapsed-delete.js';
import { checkDeleteDecided } from '#lib/invariants/collapsed-delete.js';
import type { DeleteIntent } from '#lib/browser/input.js';

function input(inputType: string, init: Partial<InputEventInit> = {}): InputEvent {
	return new InputEvent('beforeinput', { inputType, cancelable: true, ...init });
}

function reads(overrides: Partial<CollapsedDeleteReads> = {}) {
	const calls: [number, DeleteIntent][] = [];
	const base: CollapsedDeleteReads = {
		composing: () => false,
		caret: () => 3,
		hasRange: () => false,
		text: () => 'abc',
		targetRange: () => null,
		atEdge: () => false,
		deleteAtCaret: (caret, intent) => {
			calls.push([caret, intent]);
			return 'taken';
		},
		...overrides
	};
	return { base, calls };
}

describe('decideCollapsedDelete: which deletes the editor writes itself', () => {
	it('decides every delete with a side and a unit, and keeps the browser out', () => {
		for (const [type, unit, direction] of [
			['deleteContentBackward', 'character', 'backward'],
			['deleteContentForward', 'character', 'forward'],
			['deleteWordBackward', 'word', 'backward'],
			['deleteSoftLineForward', 'soft-line', 'forward'],
			['deleteHardLineBackward', 'hard-line', 'backward']
		] as const) {
			const { base, calls } = reads();
			const e = input(type);
			expect(decideCollapsedDelete(e, 'Backspace', base)).toEqual({ decided: true });
			expect(e.defaultPrevented).toBe(true);
			expect(calls).toEqual([[3, { unit, direction }]]);
		}
	});

	it('is no verdict at all for an input it never decides', () => {
		for (const type of ['insertText', 'deleteEntireSoftLine', 'deleteByCut', 'deleteContent']) {
			expect(decideCollapsedDelete(input(type), 'Backspace', reads().base)).toBeNull();
		}
	});

	const declines: [string, InputEvent, Partial<CollapsedDeleteReads>, string | null][] = [
		['composing', input('deleteContentBackward', { isComposing: true }), {}, 'Backspace'],
		['composing', input('deleteContentBackward'), { composing: () => true }, 'Backspace'],
		['not-cancelable', input('deleteContentBackward', { cancelable: false }), {}, 'Backspace'],
		['range', input('deleteContentBackward'), { hasRange: () => true }, 'Backspace'],
		['no-caret', input('deleteContentBackward'), { caret: () => null }, 'Backspace'],
		// A soft keyboard deleting an autocorrected word: the keyboard's own edit.
		[
			'wide-keyless',
			input('deleteContentBackward'),
			{ targetRange: () => ({ start: 0, end: 3 }) },
			null
		],
		['surface', input('deleteContentBackward'), { deleteAtCaret: () => 'declined' }, 'Backspace'],
		['surface', input('deleteContentBackward'), { deleteAtCaret: undefined }, 'Backspace']
	];
	for (const [decline, e, overrides, keyed] of declines) {
		it(`declines to the browser: ${decline}`, () => {
			const { base, calls } = reads(overrides);
			expect(decideCollapsedDelete(e, keyed, base)).toEqual({ decided: false, decline });
			expect(e.defaultPrevented).toBe(false);
			if (decline !== 'surface') expect(calls).toHaveLength(0);
		});
	}

	// A word names its own reach, so a soft keyboard's word delete is the editor's whatever its range.
	it('takes a keyless word delete whatever the browser says it would take', () => {
		const { base } = reads({ targetRange: () => ({ start: 0, end: 3 }) });
		expect(decideCollapsedDelete(input('deleteWordBackward'), null, base)).toEqual({
			decided: true
		});
	});

	// Miss-analysis: every edge row pressed the plain key, whose binding runs at keydown, so no row
	// saw a word, line or Shift chord at the edge do nothing.
	describe('at the edge, every delete runs what the plain key binds', () => {
		const atEdge = (keyChord: string | null, inputType: string) => {
			const ran: string[] = [];
			const { base } = reads({
				deleteAtCaret: () => 'at-edge',
				runPlainKey: (key) => void ran.push(key)
			});
			const e = input(inputType);
			expect(decideCollapsedDelete(e, keyChord, base)).toEqual({ decided: true });
			expect(e.defaultPrevented).toBe(true);
			return ran;
		};

		it('a soft keyboard, any unit, either side', () => {
			expect(atEdge(null, 'deleteContentBackward')).toEqual(['Backspace']);
			expect(atEdge(null, 'deleteWordForward')).toEqual(['Delete']);
		});

		it('a chord the keymap left alone: word, line, Shift', () => {
			expect(atEdge('Mod+Backspace', 'deleteWordBackward')).toEqual(['Backspace']);
			expect(atEdge('Alt+Backspace', 'deleteWordBackward')).toEqual(['Backspace']);
			expect(atEdge('Mod+Backspace', 'deleteSoftLineBackward')).toEqual(['Backspace']);
			expect(atEdge('Shift+Backspace', 'deleteContentBackward')).toEqual(['Backspace']);
			expect(atEdge('Mod+Delete', 'deleteWordForward')).toEqual(['Delete']);
			expect(atEdge('Alt+Delete', 'deleteSoftLineForward')).toEqual(['Delete']);
		});

		// Its binding ran at the keydown and declined; a second run would answer it twice.
		it('not the plain key itself', () => {
			expect(atEdge('Backspace', 'deleteContentBackward')).toEqual([]);
			expect(atEdge('Delete', 'deleteContentForward')).toEqual([]);
		});

		it('nothing inside the line, where the delete takes text', () => {
			const ran: string[] = [];
			const { base } = reads({ runPlainKey: (key) => void ran.push(key) });
			decideCollapsedDelete(input('deleteSoftLineBackward'), 'Mod+Backspace', base);
			expect(ran).toEqual([]);
		});
	});

	it('takes a keyed delete whatever the browser says it would take', () => {
		const { base } = reads({ targetRange: () => ({ start: 0, end: 3 }) });
		expect(decideCollapsedDelete(input('deleteContentBackward'), 'Backspace', base)).toEqual({
			decided: true
		});
	});

	it('takes a keyless delete the browser names one character for', () => {
		const { base } = reads({ targetRange: () => ({ start: 2, end: 3 }) });
		expect(decideCollapsedDelete(input('deleteContentBackward'), null, base)).toEqual({
			decided: true
		});
	});
});

// Miss-analysis: the chord's keydown answer at the edge lived inline in the surface with no unit
// test, and no answer beside a widget existed, so WebKit's silent chord did nothing.
describe('decideDeleteChord: what a delete chord does at its keydown, whatever its unit', () => {
	function chord(
		keyName: string,
		mods: KeyboardEventInit = { ctrlKey: true },
		overrides: Partial<CollapsedDeleteReads> = {}
	) {
		const beside: [number, string][] = [];
		const ran: string[] = [];
		const { base } = reads({
			deleteBeside: (caret, direction) => {
				beside.push([caret, direction]);
				return false;
			},
			atEdge: () => false,
			runPlainKey: (key) => void ran.push(key),
			...overrides
		});
		const e = new KeyboardEvent('keydown', { key: keyName, cancelable: true, ...mods });
		return { answer: decideDeleteChord(e, base), e, beside, ran };
	}

	it('takes what it faces beside the caret, by the side its key faces', () => {
		const backward = chord('Backspace', { ctrlKey: true }, { deleteBeside: () => true });
		expect([backward.answer, backward.e.defaultPrevented]).toEqual(['beside', true]);
		expect(chord('Backspace').beside).toEqual([[3, 'backward']]);
		expect(chord('Delete', { altKey: true }).beside).toEqual([[3, 'forward']]);
	});

	it('runs the plain key at the edge it faces, and nothing beside wins over the edge', () => {
		const edge = chord('Delete', { metaKey: true }, { atEdge: (_, d) => d === 'forward' });
		expect([edge.answer, edge.e.defaultPrevented, edge.ran]).toEqual(['at-edge', true, ['Delete']]);
		const both = chord(
			'Backspace',
			{ ctrlKey: true },
			{
				deleteBeside: () => true,
				atEdge: () => true
			}
		);
		expect([both.answer, both.ran]).toEqual(['beside', []]);
	});

	it('answers at the edge in a block that draws no widgets', () => {
		const h = chord(
			'Backspace',
			{ ctrlKey: true },
			{ deleteBeside: undefined, atEdge: () => true }
		);
		expect([h.answer, h.ran]).toEqual(['at-edge', ['Backspace']]);
	});

	// Shift+Backspace is Backspace on every OS, but a binding on the chord itself still wins.
	it('counts Shift as a chord', () => {
		expect(chord('Backspace', { shiftKey: true }, { deleteBeside: () => true }).answer).toBe(
			'beside'
		);
	});

	// Inside the line the reach depends on the unit, which only the input names.
	it('leaves a delete that meets nothing and no edge to its input', () => {
		const h = chord('Backspace');
		expect([h.answer, h.e.defaultPrevented, h.ran]).toEqual([null, false, []]);
	});

	const passes: [string, string, KeyboardEventInit, Partial<CollapsedDeleteReads>][] = [
		['the plain key, which the block decided', 'Backspace', {}, {}],
		['another key', 'ArrowLeft', { ctrlKey: true }, {}],
		['a held range', 'Backspace', { ctrlKey: true }, { hasRange: () => true }],
		['no caret', 'Backspace', { ctrlKey: true }, { caret: () => null }],
		['a composition', 'Backspace', { ctrlKey: true, isComposing: true }, {}]
	];
	for (const [name, keyName, mods, overrides] of passes) {
		it(`asks nothing for ${name}`, () => {
			const h = chord(keyName, mods, { ...overrides, atEdge: () => true });
			expect([h.answer, h.e.defaultPrevented, h.beside, h.ran]).toEqual([null, false, [], []]);
		});
	}

	it('asks nothing for a chord a binding already prevented', () => {
		const ran: string[] = [];
		const { base } = reads({ atEdge: () => true, runPlainKey: (key) => void ran.push(key) });
		const e = new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, cancelable: true });
		e.preventDefault();
		expect([decideDeleteChord(e, base), ran]).toEqual([null, []]);
	});
});

describe('G1.132 checkDeleteDecided: no delete the editor decides reaches input undecided', () => {
	it('passes a declined delete and any input the editor never decides', () => {
		const declined = { decided: false, decline: 'composing' } as const;
		expect(checkDeleteDecided({ inputType: 'deleteContentBackward' }, declined)).toBeNull();
		expect(checkDeleteDecided({ inputType: 'insertText' }, null)).toBeNull();
		expect(checkDeleteDecided({ inputType: 'deleteEntireSoftLine' }, null)).toBeNull();
	});

	it('fails a delete no delete step saw, and one the browser ran after the editor wrote it', () => {
		expect(checkDeleteDecided({ inputType: 'deleteContentBackward' }, null)?.code).toBe(
			'delete-never-decided'
		);
		expect(checkDeleteDecided({ inputType: 'deleteContentForward' }, { decided: true })?.code).toBe(
			'delete-not-prevented'
		);
	});
});

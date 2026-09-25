import { describe, it, expect } from 'vitest';
import { createCaretMemory, type CaretMemory } from '../../cursor/caret-memory';
import { asEditorX } from '../../cursor/coordinate-spaces';
import type { AnyCommandId } from '../../schema/command-id';

// The caret's short-lived memory has one lifetime: a key updates all of it, anything else drops
// all of it. The key tables live beside their classifiers; this file holds how the three parts
// move together. Miss-analysis: each part was tested alone, so a site resetting the column
// without the side passed every test until a typed byte landed on the stale side.

const measure = (x: number | null) => () => (x === null ? null : asEditorX(x));

/** A memory mid-run: column held, the near side recorded, a mark pending. */
function arrived(): CaretMemory {
	const m = createCaretMemory();
	m.noteKey({ key: 'ArrowDown' }, null, measure(240));
	m.pendingMarks.toggle('strong');
	return m;
}

function snapshot(m: CaretMemory) {
	const marks = m.pendingMarks.get();
	return { column: m.column(), side: m.side(), marks: marks ? [...marks].sort() : null };
}

describe('caret memory lifetime', () => {
	it('forget drops the column, the side and the marks together', () => {
		const m = arrived();
		expect(snapshot(m)).toEqual({ column: 240, side: 'near', marks: ['strong'] });
		m.forget();
		expect(snapshot(m)).toEqual({ column: null, side: null, marks: null });
	});

	it('a committed byte drops the column and the marks and means the near side', () => {
		const m = arrived();
		m.noteTyping();
		expect(snapshot(m)).toEqual({ column: null, side: 'near', marks: null });
	});

	// A collapse onto a range's own edge is a placement inside a vertical run, so the column
	// survives it while the side and the marks do not.
	it('an end placement means the outside, drops the marks and keeps the column', () => {
		const m = arrived();
		m.noteExtreme();
		expect(snapshot(m)).toEqual({ column: 240, side: 'outside', marks: null });
	});

	it('instances are independent', () => {
		const a = arrived();
		const b = createCaretMemory();
		expect(snapshot(b)).toEqual({ column: null, side: null, marks: null });
		a.forget();
		b.pendingMarks.toggle('emphasis');
		expect(snapshot(a).marks).toBeNull();
	});
});

// Each row names what one key leaves of a memory that arrived with a column, a side and a mark.
describe('noteKey across the three parts', () => {
	const ROWS: [key: string, column: number | null, side: string | null, marks: boolean][] = [
		['ArrowUp', 240, 'far', false],
		['ArrowLeft', null, 'far', false],
		['PageDown', 240, 'near', false],
		['Home', null, 'outside', false],
		['Enter', null, null, false],
		['Escape', null, null, false],
		['Shift', 240, 'near', true],
		['b', null, 'near', true]
	];

	for (const [key, column, side, marks] of ROWS) {
		it(`${key} leaves column ${column}, side ${side}, marks ${marks ? 'kept' : 'dropped'}`, () => {
			const m = arrived();
			m.noteKey({ key }, null, measure(999));
			expect(snapshot(m)).toEqual({ column, side, marks: marks ? ['strong'] : null });
		});
	}

	// The column was taken on the first arrow of the run; a later arrow's x is a clamped one.
	it('a vertical arrow keeps the column the run started with', () => {
		const m = createCaretMemory();
		m.noteKey({ key: 'ArrowDown' }, null, measure(120));
		m.noteKey({ key: 'ArrowDown' }, null, measure(40));
		expect(m.column()).toBe(120);
	});

	it('a vertical arrow with nothing to measure keeps the column rather than clearing it', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowDown' }, null);
		m.noteKey({ key: 'ArrowDown' }, null, measure(null));
		expect(m.column()).toBe(240);
	});

	it('meta+ArrowRight is a line end, the outside', () => {
		const m = createCaretMemory();
		m.noteKey({ key: 'ArrowRight', metaKey: true }, null);
		expect(m.side()).toBe('outside');
	});
});

// A chord that moves the caret's block or row keeps the memory: the move's commit forgets it.
// The chord comes from the keymap, so a rebinding moves the rule with it.
describe('noteKey reads the chord as the command it resolves to', () => {
	const MOVES: AnyCommandId[] = [
		'block.moveUp',
		'block.moveDown',
		'table.moveRowUp',
		'table.moveRowDown'
	];

	for (const command of MOVES) {
		it(`${command} keeps the column, the side and the marks`, () => {
			const m = arrived();
			m.noteKey({ key: 'ArrowUp' }, command, measure(999));
			expect(snapshot(m)).toEqual({ column: 240, side: 'near', marks: ['strong'] });
		});
	}

	// `block.moveUp` rebound off Alt+ArrowUp: the old chord is now an ordinary arrow, and the new
	// chord, whatever its key, is the move.
	it('an unbound Alt+ArrowUp is an arrow like any other', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowUp', altKey: true } as KeyboardEvent, null, measure(999));
		expect(snapshot(m)).toEqual({ column: 240, side: 'far', marks: null });
	});

	it('a move bound to a letter chord keeps the memory', () => {
		const m = arrived();
		m.noteKey({ key: 'K' }, 'block.moveUp');
		expect(snapshot(m)).toEqual({ column: 240, side: 'near', marks: ['strong'] });
	});

	it('a move bound to ArrowLeft keeps the column the arrow would have dropped', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowLeft' }, 'block.moveDown');
		expect(m.column()).toBe(240);
	});

	it('any other command is classified by its key', () => {
		const m = arrived();
		m.noteKey({ key: 'Enter' }, 'block.split');
		expect(snapshot(m)).toEqual({ column: null, side: null, marks: null });
	});
});

describe('captureColumn', () => {
	it('keeps a column already held', () => {
		const m = createCaretMemory();
		m.captureColumn(asEditorX(150));
		m.captureColumn(asEditorX(200));
		expect(m.column()).toBe(150);
	});

	for (const invalid of [NaN, Infinity, -Infinity]) {
		it(`rejects ${invalid}`, () => {
			const m = createCaretMemory();
			m.captureColumn(asEditorX(invalid));
			expect(m.column()).toBeNull();
		});
	}

	it('accepts zero and negative columns', () => {
		const m = createCaretMemory();
		m.captureColumn(asEditorX(0));
		expect(m.column()).toBe(0);
		m.forget();
		m.captureColumn(asEditorX(-10));
		expect(m.column()).toBe(-10);
	});
});

describe('pending marks', () => {
	it('exactly one insertion spends the set', () => {
		const m = createCaretMemory();
		m.pendingMarks.toggle('strong');
		expect([...(m.pendingMarks.consume() ?? [])]).toEqual(['strong']);
		expect(m.pendingMarks.consume()).toBeNull();
	});

	// An IME cancel hands the set back, unless a newer toggle already spoke for the caret.
	it('restore gives back an unspent set and declines over a newer one', () => {
		const m = createCaretMemory();
		m.pendingMarks.toggle('strong');
		const taken = m.pendingMarks.consume()!;
		m.pendingMarks.restore(taken);
		expect([...(m.pendingMarks.get() ?? [])]).toEqual(['strong']);

		const again = m.pendingMarks.consume()!;
		m.pendingMarks.toggle('emphasis');
		m.pendingMarks.restore(again);
		expect([...(m.pendingMarks.get() ?? [])]).toEqual(['emphasis']);
	});
});

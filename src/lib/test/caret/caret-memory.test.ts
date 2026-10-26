import { describe, it, expect } from 'vitest';
import { registerBlockCommand } from '../../schema/block-commands';
import { createCaretMemory, type CaretMemory } from '../../caret/caret-memory';
import { asEditorX } from '../../core/coordinate-spaces';
import type { AnyCommandId } from '../../schema/command-id';
import { marksPending, pendMark } from '../harness/pending-marks';

// The caret's short-lived memory has one lifetime: a key updates all of it, anything else drops
// all of it; this file holds how its three parts move together.
// Miss-analysis: each part was tested alone, so resetting the column without the side passed.

const measure = (x: number | null) => () => (x === null ? null : asEditorX(x));

/** A memory mid-run: column held, arrived by a key, a mark pending. */
function arrived(): CaretMemory {
	const m = createCaretMemory();
	m.noteKey({ key: 'ArrowDown' }, null, measure(240));
	pendMark(m);
	return m;
}

function snapshot(m: CaretMemory) {
	return { column: m.column(), side: m.side(), byKey: m.arrivedByKey(), marks: marksPending(m) };
}

describe('caret memory lifetime', () => {
	it('forget drops the column, the side and the marks together', () => {
		const m = arrived();
		expect(snapshot(m)).toEqual({ column: 240, side: null, byKey: true, marks: true });
		m.forget();
		expect(snapshot(m)).toEqual({ column: null, side: null, byKey: false, marks: false });
	});

	it('a committed byte drops the column, the record and the marks', () => {
		const m = arrived();
		m.noteOutside();
		m.noteTyping();
		expect(snapshot(m)).toEqual({ column: null, side: null, byKey: false, marks: false });
	});

	// A typed closer or a fresh start doesn't end a vertical run's column.
	it('the outside record drops the marks and keeps the column', () => {
		const m = arrived();
		m.noteOutside();
		expect(snapshot(m)).toEqual({ column: 240, side: 'outside', byKey: false, marks: false });
	});

	it('instances are independent', () => {
		const a = arrived();
		const b = createCaretMemory();
		expect(snapshot(b)).toEqual({ column: null, side: null, byKey: false, marks: false });
		a.forget();
		pendMark(b, 'emphasis');
		expect(snapshot(a).marks).toBe(false);
	});
});

// Each row names what one key leaves of a memory that arrived with a column, the outside record
// and a mark.
describe('noteKey across the parts', () => {
	const ROWS: [key: string, column: number | null, side: string | null, byKey: boolean][] = [
		['ArrowUp', 240, null, true],
		['ArrowLeft', null, null, true],
		['PageDown', 240, null, true],
		['Home', null, null, true],
		['End', null, null, true],
		['Enter', null, null, false],
		['Escape', null, null, false],
		['Shift', 240, 'outside', false],
		['b', null, 'outside', false]
	];

	for (const [key, column, side, byKey] of ROWS) {
		it(`${key} leaves column ${column}, record ${side}, arrived by key ${byKey}`, () => {
			const m = arrived();
			m.noteOutside();
			pendMark(m);
			m.noteKey({ key }, null, measure(999));
			expect(snapshot(m)).toEqual({ column, side, byKey, marks: side !== null });
		});
	}

	// The column was taken on the first arrow of the run; a later arrow's x is a clamped one.
	it('a vertical arrow keeps the column the run started with', () => {
		const m = createCaretMemory();
		m.noteKey({ key: 'ArrowDown' }, null, measure(120));
		m.noteKey({ key: 'ArrowDown' }, null, measure(40));
		expect(m.column()).toBe(120);
	});

	// Miss-analysis: every row handed a measure that only returns, so one that asks the browser for
	// the caret's line at a soft wrap (and so resets Firefox's own column) ran on every arrow unseen.
	it('a later arrow of the run measures nothing', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowDown' }, null, () => {
			throw new Error('measured a held column');
		});
		expect(m.column()).toBe(240);
	});

	it('a vertical arrow with nothing to measure keeps the column rather than clearing it', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowDown' }, null);
		m.noteKey({ key: 'ArrowDown' }, null, measure(null));
		expect(m.column()).toBe(240);
	});

	// End lands on text like any arrow, where the character before the caret decides.
	it('a line-end key ends the outside record like any arrow', () => {
		const m = createCaretMemory();
		m.noteOutside();
		m.noteKey({ key: 'End' }, null);
		expect(m.side()).toBeNull();
	});
});

// Miss-analysis: the first cut kept the pin for one note, and a keydown is noted twice.
describe('a pin for where a key lands', () => {
	it('outlives every note of its own key and drops at the next key', () => {
		const m = createCaretMemory();
		const end = { key: 'End' };
		m.pinOnArrival(end, 10);
		m.noteKey(end, null);
		m.noteKey(end, null);
		expect(m.side()).toEqual({ offset: 10 });
		m.noteKey({ key: 'End' }, null);
		expect(m.side()).toBeNull();
	});

	it('a key that is not its own drops it unrecorded', () => {
		const m = createCaretMemory();
		m.pinOnArrival({ key: 'End' }, 10);
		m.noteKey({ key: 'ArrowRight' }, null);
		expect(m.side()).toBeNull();
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
		it(`${command} keeps the column, the record and the marks`, () => {
			const m = arrived();
			m.noteKey({ key: 'ArrowUp' }, command, measure(999));
			expect(snapshot(m)).toEqual({ column: 240, side: null, byKey: true, marks: true });
		});
	}

	// `block.moveUp` rebound off Alt+ArrowUp: the default chord is an ordinary arrow, and the new
	// chord, whatever its key, is the move.
	it('an unbound Alt+ArrowUp is an arrow like any other', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowUp', altKey: true } as KeyboardEvent, null, measure(999));
		expect(snapshot(m)).toEqual({ column: 240, side: null, byKey: true, marks: false });
	});

	it('a move bound to a letter chord keeps the memory', () => {
		const m = arrived();
		m.noteKey({ key: 'K' }, 'block.moveUp');
		expect(snapshot(m)).toEqual({ column: 240, side: null, byKey: true, marks: true });
	});

	it('a move bound to ArrowLeft keeps the column the arrow would have dropped', () => {
		const m = arrived();
		m.noteKey({ key: 'ArrowLeft' }, 'block.moveDown');
		expect(m.column()).toBe(240);
	});

	it('any other command is classified by its key', () => {
		const m = arrived();
		m.noteKey({ key: 'Enter' }, 'block.split');
		expect(snapshot(m)).toEqual({ column: null, side: null, byKey: false, marks: false });
	});
});

describe('noteKey reads a plugin command by its key', () => {
	it('a plugin command is classified by its key', () => {
		const other = registerBlockCommand('paragraph', 'caretTest.other', () => true);
		const m = arrived();
		m.noteKey({ key: 'ArrowUp' }, other);
		expect(snapshot(m)).toEqual({ column: 240, side: null, byKey: true, marks: false });
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

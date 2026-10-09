// Every call that changes what the caret memory answers asks the drawn caret to repaint, and a call
// that changes nothing asks nothing: a typed letter sets the side again on every key. The memory's
// methods are read off the object, so a new one has to join a table here before the row passes.
import { describe, expect, it } from 'vitest';
import { createCaretMemory, type CaretMemory } from '#lib/caret/caret-memory.js';

const BLOCK = {};
const LINE = { textEnd: 3, lineEnd: 3, ending: '\n' as const };

type Step = (memory: CaretMemory) => void;

/** For each method: a call from a state where it changes the answer, and, where one exists, a call
 *  that changes nothing. `from` builds the state before the counted call. */
const CHANGES: Record<
	string,
	{ change: [from: Step, call: Step]; noop?: [from: Step, call: Step] }
> = {
	noteKey: {
		change: [() => {}, (m) => m.noteKey({ key: 'ArrowRight' }, null)],
		noop: [
			(m) => m.noteKey({ key: 'ArrowRight' }, null),
			(m) => m.noteKey({ key: 'ArrowDown' }, null)
		]
	},
	noteTyping: {
		change: [() => {}, (m) => m.noteTyping()],
		noop: [(m) => m.noteTyping(), (m) => m.noteTyping()]
	},
	noteExtreme: {
		change: [() => {}, (m) => m.noteExtreme()],
		noop: [(m) => m.noteExtreme(), (m) => m.noteExtreme()]
	},
	pin: {
		change: [() => {}, (m) => m.pin(3)],
		noop: [(m) => m.pin(3), (m) => m.pin(3)]
	},
	forget: {
		change: [(m) => m.noteTyping(), (m) => m.forget()],
		noop: [() => {}, (m) => m.forget()]
	},
	'pendingMarks.toggle': {
		change: [() => {}, (m) => m.pendingMarks.toggle('strong')]
	},
	'pendingMarks.consume': {
		change: [(m) => m.pendingMarks.toggle('strong'), (m) => m.pendingMarks.consume()],
		noop: [() => {}, (m) => m.pendingMarks.consume()]
	},
	'pendingMarks.restore': {
		change: [() => {}, (m) => m.pendingMarks.restore(new Set(['strong']))],
		noop: [
			(m) => m.pendingMarks.toggle('emphasis'),
			(m) => m.pendingMarks.restore(new Set(['strong']))
		]
	},
	'pendingBreak.forBlock().open': {
		change: [() => {}, (m) => m.pendingBreak.forBlock(BLOCK).open(LINE)]
	},
	'pendingBreak.forBlock().end': {
		change: [
			(m) => m.pendingBreak.forBlock(BLOCK).open(LINE),
			(m) => m.pendingBreak.forBlock(BLOCK).end()
		],
		noop: [() => {}, (m) => m.pendingBreak.forBlock(BLOCK).end()]
	}
};

/** Methods the row doesn't hold to the rule, each with why. */
const EXEMPT: Record<string, string> = {
	column: 'a read',
	side: 'a read',
	'pendingMarks.get': 'a read',
	'pendingBreak.forBlock().lines': 'a read',
	'pendingBreak.forBlock().at': 'a read',
	'heldSpace.forBlock().at': 'a read',
	'heldSpace.forBlock().inside': 'a read',
	previewInsertion: 'a read: it spends nothing',
	changeCount: 'a read',
	holdInsertion:
		'its records change only inside a write, which asks for its own paint when it puts the caret back',
	captureColumn: 'the column aims a run of Up and Down presses, and the drawn caret never reads it'
};

/** Every method the memory exposes, nested ones by path, a block's view through `forBlock()`. */
function methodsOf(memory: CaretMemory): string[] {
	const names: string[] = [];
	for (const [key, value] of Object.entries(memory)) {
		if (typeof value === 'function') {
			names.push(key);
			continue;
		}
		for (const [inner, member] of Object.entries(value as object)) {
			if (inner !== 'forBlock') names.push(`${key}.${inner}`);
			else
				for (const viewKey of Object.keys(member(BLOCK)))
					names.push(`${key}.forBlock().${viewKey}`);
		}
	}
	return names.sort();
}

/** Repaint requests `call` makes from the state `from` leaves. */
function requests([from, call]: [Step, Step]): number {
	let asked = 0;
	const memory = createCaretMemory({ onChange: () => asked++ });
	from(memory);
	asked = 0;
	call(memory);
	return asked;
}

describe('G4.147 the caret memory’s repaint requests', () => {
	it('cover every method it exposes', () => {
		const listed = [...Object.keys(CHANGES), ...Object.keys(EXEMPT)].sort();
		expect(
			methodsOf(createCaretMemory({ onChange: () => {} })),
			'a new caret memory method: call `onChange` where it changes an answer and add it to CHANGES, or add it to EXEMPT with the reason'
		).toEqual(listed);
	});

	it.each(Object.entries(CHANGES))(
		'%s asks for a paint when it changes the answer',
		(_name, row) => {
			expect(requests(row.change)).toBeGreaterThan(0);
		}
	);

	it.each(Object.entries(CHANGES).filter(([, row]) => row.noop))(
		'%s asks for none when it changes nothing',
		(_name, row) => {
			expect(requests(row.noop!)).toBe(0);
		}
	);
});

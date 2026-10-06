// What the next insertion spends: a held record stays in effect until its write lets go of it, a
// record the write extends waits on for the next one, and anything else ends it.
// Miss-analysis: each record kept its own "deaf while held" flag, so a second record could forget
// it, and the hold cleared the record it took, so a composition unpainted the pending break.
import { describe, it, expect } from 'vitest';
import {
	createInsertionRecords,
	insertsAt,
	type InsertionRecord,
	type InsertionSpend
} from '$lib/cursor/next-insertion';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { createSurfaceWrite } from '$lib/components/blocks/surface-write';
import { stubBlockEdit } from '$lib/testing/headless-actions';
import type { NodeView } from '$lib/core/node-views';

/** A toy record that waits at `at` and grows with every insertion there, the way a held run of
 *  spaces would. It knows nothing about holds: its `end` drops it whenever it is called. */
function growingRun(at: number) {
	const state = { at, waiting: true };
	const record: InsertionRecord = {
		take: () => {
			if (!state.waiting) return null;
			const spend: InsertionSpend = {
				at: state.at,
				apply: (before, edit) => {
					if (!insertsAt(before, edit.text, state.at)) return null;
					state.at += edit.text.length - before.length;
					return { ...edit, kept: true };
				},
				release: (waiting) => {
					state.waiting = waiting;
				}
			};
			return spend;
		},
		end: () => {
			state.waiting = false;
		}
	};
	return { state, record };
}

const BLOCK = {};

describe('a hold on the records', () => {
	it('keeps a record the write extends, at its new offset', () => {
		const { state, record } = growingRun(2);
		const records = createInsertionRecords([record]);

		const held = records.hold(BLOCK, null);
		held.spend('ab', { text: 'ab ', caretAfter: 3 });
		records.end();
		held.finish(true);

		expect(state).toEqual({ at: 3, waiting: true });
	});

	it('ends a record the write doesn’t insert at', () => {
		const { state, record } = growingRun(2);

		const held = createInsertionRecords([record]).hold(BLOCK, null);
		held.spend('ab', { text: 'xab', caretAfter: 1 });
		held.finish(true);

		expect(state.waiting).toBe(false);
	});

	it('leaves every record waiting after a write that changed nothing', () => {
		const { state, record } = growingRun(2);

		createInsertionRecords([record]).hold(BLOCK, null).finish(false);

		expect(state.waiting).toBe(true);
	});

	it('keeps a held record from any end, whatever the record does with one', () => {
		const { state, record } = growingRun(2);
		const records = createInsertionRecords([record]);

		const held = records.hold(BLOCK, null);
		records.end();
		records.end(record, BLOCK);
		expect(state.waiting).toBe(true);
		expect(records.hold(BLOCK, null).empty).toBe(true);

		held.finish(true);
		expect(state.waiting).toBe(false);
	});
});

/** Each record the caret memory keeps, opened in `BLOCK` and read back from its own view. */
const MEMORY_RECORDS = [
	{
		name: 'the pending break',
		open: (memory: ReturnType<typeof createCaretMemory>) =>
			memory.pendingBreak.forBlock(BLOCK).open({ textEnd: 3, lineEnd: 3, ending: '\n' }),
		waiting: (memory: ReturnType<typeof createCaretMemory>) =>
			memory.pendingBreak.forBlock(BLOCK).lines() > 0
	}
];

describe.each(MEMORY_RECORDS)('$name, held by a write', ({ open, waiting }) => {
	it('stays in effect through the caret memory’s forget, and ends with its hold', () => {
		const memory = createCaretMemory();
		open(memory);

		const held = memory.holdInsertion(BLOCK);
		memory.forget();
		expect(waiting(memory)).toBe(true);

		held.finish(true);
		expect(waiting(memory)).toBe(false);
	});
});

describe('writeText and a record the write extends', () => {
	it('spends it on every typed write it grows with', async () => {
		const { state, record } = growingRun(2);
		const records = createInsertionRecords([record]);
		let raw = 'ab\n';
		const writeText = createSurfaceWrite({
			getNode: () => ({ kind: 'paragraph', leadingTrivia: '', raw }) as NodeView,
			getIndex: () => 0,
			getPath: () => [0],
			blockEdit: {
				...stubBlockEdit(),
				updateBlockContent: (...args) => {
					raw = args[1];
					// The write's own forget, which a held record has to outlast.
					records.end();
					return stubBlockEdit().updateBlockContent(...args);
				}
			},
			kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
			getPreEditOffset: () => 0,
			requestCaret: () => {},
			holdInsertion: () => records.hold(BLOCK, null)
		});
		const typed = { intent: 'typed', mode: 'authored', source: 'test' } as const;

		void writeText({ ...typed, text: 'ab ', caretAfter: 3 });
		void writeText({ ...typed, text: 'ab  ', caretAfter: 4 });

		expect(state).toEqual({ at: 4, waiting: true });
	});
});

// What the next insertion spends: a held record stays in effect until its write lets go of it, a
// record the write extends waits on for the next one, and anything else ends it.
// Miss-analysis: the hold cleared the record it took, so a composition unpainted the pending
// break, and no record could outlive a write that extended it.
import { describe, it, expect } from 'vitest';
import {
	holdInsertion,
	insertsAt,
	type InsertionRecord,
	type InsertionSpend
} from '$lib/cursor/next-insertion';
import { createPendingBreak } from '$lib/cursor/pending-break.svelte';
import { createSurfaceWrite } from '$lib/components/blocks/surface-write';
import { stubBlockEdit } from '$lib/testing/headless-actions';
import type { NodeView } from '$lib/core/node-views';

/** A toy record that waits at `at` and grows with every insertion there, the way a held run of
 *  spaces would. `waiting` is what a hold would leave in effect. */
function growingRun(at: number) {
	const state = { at, waiting: true, held: false };
	const record: InsertionRecord = {
		take: () => {
			if (!state.waiting || state.held) return null;
			state.held = true;
			const spend: InsertionSpend = {
				at: state.at,
				apply: (before, edit) => {
					if (!insertsAt(before, edit.text, state.at)) return null;
					state.at += edit.text.length - before.length;
					return { ...edit, kept: true };
				},
				release: (waiting) => {
					state.held = false;
					state.waiting = waiting;
				}
			};
			return spend;
		},
		end: () => {
			if (!state.held) state.waiting = false;
		}
	};
	return { state, record };
}

const BLOCK = {};

describe('holdInsertion', () => {
	it('keeps a record the write extends, at its new offset', () => {
		const { state, record } = growingRun(2);

		const held = holdInsertion([record], BLOCK, null);
		held.spend('ab', { text: 'ab ', caretAfter: 3 });
		record.end();
		held.finish(true);

		expect(state).toEqual({ at: 3, waiting: true, held: false });
	});

	it('ends a record the write doesn’t insert at', () => {
		const { state, record } = growingRun(2);

		const held = holdInsertion([record], BLOCK, null);
		held.spend('ab', { text: 'xab', caretAfter: 1 });
		held.finish(true);

		expect(state.waiting).toBe(false);
	});

	it('leaves every record waiting after a write that changed nothing', () => {
		const { state, record } = growingRun(2);

		holdInsertion([record], BLOCK, null).finish(false);

		expect(state.waiting).toBe(true);
	});
});

describe('a held pending break', () => {
	it('stays drawn while a write holds it, deaf to the caret memory’s end', () => {
		const pendingBreak = createPendingBreak();
		const view = pendingBreak.forBlock(BLOCK);
		view.open({ textEnd: 3, lineEnd: 3, ending: '\n' });

		const held = holdInsertion([pendingBreak], BLOCK, null);
		pendingBreak.end();
		expect(view.lines()).toBe(1);

		held.finish(true);
		expect(view.lines()).toBe(0);
	});
});

describe('writeText and a record the write extends', () => {
	it('spends it on every typed write it grows with', async () => {
		const { state, record } = growingRun(2);
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
					record.end();
					return stubBlockEdit().updateBlockContent(...args);
				}
			},
			kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
			getPreEditOffset: () => 0,
			requestCaret: () => {},
			holdInsertion: () => holdInsertion([record], BLOCK, null)
		});
		const typed = { intent: 'typed', mode: 'authored', source: 'test' } as const;

		void writeText({ ...typed, text: 'ab ', caretAfter: 3 });
		void writeText({ ...typed, text: 'ab  ', caretAfter: 4 });

		expect(state).toEqual({ at: 4, waiting: true, held: false });
	});
});

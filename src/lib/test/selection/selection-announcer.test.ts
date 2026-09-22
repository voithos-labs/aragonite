// Miss-analysis: nothing sat between the editor's snapshot and the event, so "the browser
// repeated a position subscribers already have" had nowhere to be asserted.
import { describe, it, expect } from 'vitest';
import { createSelectionAnnouncer } from '$lib/selection/selection-announcer';
import type { EditorSelection } from '$lib/selection/primitives';

const caretAt = (path: number[], offset: number): EditorSelection => ({
	anchor: { path, offset },
	focus: { path, offset }
});

function harness(script: (EditorSelection | null)[]) {
	const sent: (EditorSelection | null)[] = [];
	let step = 0;
	const announcer = createSelectionAnnouncer({
		read: () => script[Math.min(step, script.length - 1)] ?? null,
		emit: (selection) => sent.push(selection)
	});
	return { announcer, sent, advance: () => step++ };
}

describe('the selection announcer', () => {
	it('sends the same position once, however often the browser reports it', () => {
		const { announcer, sent } = harness([caretAt([1], 0)]);
		announcer.announceIfMoved();
		announcer.announceIfMoved();
		announcer.announceIfMoved();
		expect(sent).toEqual([caretAt([1], 0)]);
	});

	it('sends a repeat the editor asks for, so a blur can report the selection it drops', () => {
		const { announcer, sent } = harness([null]);
		announcer.announceIfMoved();
		announcer.announce();
		expect(sent).toEqual([null, null]);
	});

	it('sends every move, including a return to a position announced before', () => {
		const { announcer, sent, advance } = harness([
			caretAt([0], 2),
			caretAt([3], 1),
			caretAt([0], 2)
		]);
		announcer.announceIfMoved();
		advance();
		announcer.announceIfMoved();
		advance();
		announcer.announceIfMoved();
		expect(sent).toEqual([caretAt([0], 2), caretAt([3], 1), caretAt([0], 2)]);
	});

	it('reads a cell index and a character offset of the same number as different positions', () => {
		const cell: EditorSelection = {
			anchor: { path: [4], offset: 2, cellCoordinate: true },
			focus: { path: [4], offset: 2, cellCoordinate: true }
		};
		const { announcer, sent, advance } = harness([caretAt([4], 2), cell]);
		announcer.announceIfMoved();
		advance();
		announcer.announceIfMoved();
		expect(sent).toHaveLength(2);
	});
});

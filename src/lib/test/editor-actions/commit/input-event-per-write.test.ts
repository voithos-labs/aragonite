import { describe, it, expect } from 'vitest';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

const ops = (edits: EditEvent[]) => edits.map((e) => [e.op, e.path]);

// A typed write fires its own `input` edit as it lands; the undo batch's pause decides nothing.
describe('typing fires one input edit per write', () => {
	it('each keystroke fires before the next one is typed, with its leaf and its own length', async () => {
		const { actions, edits } = makeTopHarness('aaa\n\nbbb\n');

		await actions.updateBlockContent(0, 'aaax\n', 'authored', 3);
		expect(edits.map((e) => [e.op, e.path, e.detail])).toEqual([['input', [0], { byteLength: 5 }]]);

		await actions.updateBlockContent(0, 'aaaxy\n', 'authored', 4);
		await actions.updateBlockContent(1, 'bbbz\n', 'authored', 3);
		expect(ops(edits)).toEqual([
			['input', [0]],
			['input', [0]],
			['input', [1]]
		]);
	});

	it('a structural commit mid-burst comes after the keystrokes typed before it', async () => {
		const { actions, edits } = makeTopHarness('hello\n');

		await actions.updateBlockContent(0, 'hellox\n', 'authored', 5);
		await actions.splitBlock(0, 6);

		expect(edits.map((e) => e.op)).toEqual(['input', 'split']);
	});

	it('a structural commit with no typing before it fires no input', async () => {
		const { actions, edits } = makeTopHarness('hello\n');

		await actions.splitBlock(0, 5);

		expect(edits.map((e) => e.op)).toEqual(['split']);
	});
});

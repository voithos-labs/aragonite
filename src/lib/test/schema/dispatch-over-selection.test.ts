// @vitest-environment jsdom
// The dispatch asks a block to remove its own selection only where the block holds one: never under
// a range spanning blocks, and with a dev warning where the block has no way to.
// Miss-analysis: every removal row ran on a block that supplies the removal with no range up, so
// nothing asked the dispatch about either edge.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCommandById } from '$lib/schema/block-commands';
import { takeDevWarns } from '../support/warn-gate';
import { commandContextWith } from '../support/command-context';

/** A live, non-collapsed document selection, the state the dev warning looks for. */
function selectSomeText(): void {
	document.body.innerHTML = '<p>alpha</p>';
	const text = document.body.querySelector('p')!.firstChild!;
	const range = document.createRange();
	range.setStart(text, 1);
	range.setEnd(text, 3);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
}

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('the block command dispatch over a selection', () => {
	it('asks for no removal while a range spans blocks', () => {
		const runCommand = vi.fn(() => true);
		const afterSelectionRemoved = vi.fn(() => true);
		const ctx = commandContextWith(undefined, { isCrossBlockRange: () => true });

		runCommandById(
			'block.split',
			undefined,
			{ kind: 'paragraph', runCommand, afterSelectionRemoved },
			ctx
		);

		expect(afterSelectionRemoved).not.toHaveBeenCalled();
		expect(runCommand).toHaveBeenCalledWith('block.split', undefined, { afterRemoval: false });
	});

	it('warns once when the block has no removal and a selection is live', () => {
		selectSomeText();
		const target = { kind: 'paragraph' as const, runCommand: vi.fn(() => true) };
		const ctx = commandContextWith(undefined);

		runCommandById('block.split', undefined, target, ctx);
		runCommandById('block.split', undefined, target, ctx);

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
		expect(target.runCommand).toHaveBeenCalledTimes(2);
	});

	it('stays quiet at a caret', () => {
		const target = { kind: 'heading' as const, runCommand: vi.fn(() => true) };

		runCommandById('block.split', undefined, target, commandContextWith(undefined));

		expect(takeDevWarns()).toEqual([]);
	});
});

// @vitest-environment jsdom
//
// Miss-analysis: the cell's reveal-fold rule was pinned on the two paths that already carried it
// (the Enter carve-out, the clipboard skeleton), and every other case that drove a cell mutation
// drove it with no reveal open — so the rule read as enforced while three sibling mutation seams
// ran straight past it, and the table rebuild that discards the edit leaves the bytes well formed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { resetInlineState } from '../text/math-widget-fixture';
import { mountCell, settleTicks } from './mount-cell';

const CELL = 'x $a$ yz';

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Open the widget's source reveal and type into it — an edit that lives in ephemeral DOM until
 *  something folds it, exactly as the user's does. */
async function revealAndEdit(el: HTMLElement, edited: string): Promise<void> {
	press(el, 'ArrowLeft');
	await settleTicks();
	const source = Array.from(el.childNodes).find(
		(c) => c.nodeType === Node.TEXT_NODE && c.textContent === '$a$'
	);
	expect(source, 'the reveal did not swap the widget for its source').toBeDefined();
	(source as Text).textContent = edited;
}

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
	resetInlineState();
});

describe('a cell mutation folds the open reveal before it runs', () => {
	// The confirmed loss: insertRowBelow re-derives every row from cell `.raw`, so an unfolded
	// reveal's edit is not merely uncommitted — it is gone, with no gesture left to recover it.
	it('commits the revealed edit before an axis command rebuilds the table', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance, tableContext } = mounted;
		el.focus();
		instance.setSelection(5, 5);
		await revealAndEdit(el, '$a_n$');

		expect(instance.runCommand('table.insertRowBelow')).toBe(true);
		await settleTicks();

		const commits = vi.mocked(blockEdit.updateBlockContent).mock.calls;
		expect(commits.map((c) => c[1])).toEqual(['x $a_n$ yz']);
		expect(tableContext.insertRowBelow).toHaveBeenCalledTimes(1);
		expect(vi.mocked(blockEdit.updateBlockContent).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(tableContext.insertRowBelow).mock.invocationCallOrder[0]
		);
	});

	// The implicit-commit sibling: the toggle reads the revealed DOM text and writes it back as
	// the cell's raw, leaving the reveal open over bytes it no longer matches.
	it('folds before a format toggle rather than committing the revealed text as raw', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);
		await revealAndEdit(el, '$a_n$');

		instance.runCommand('format.toggleStrong');
		await settleTicks();

		expect(vi.mocked(blockEdit.updateBlockContent).mock.calls[0][1]).toBe('x $a_n$ yz');
	});
});

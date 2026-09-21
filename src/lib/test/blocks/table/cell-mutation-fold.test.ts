// @vitest-environment jsdom
//
// Miss-analysis: the rule that a cell hides a shown source before editing was covered only on the
// two paths that already followed it, the Enter case and the shared clipboard handlers, and every
// other case drove an edit with no source shown, so the rule looked enforced while three sibling
// paths ran past it, and the table rebuild that discards the edit leaves the bytes well formed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { resetInlineState } from '../text/math-widget-fixture';
import { mountCell, settleTicks } from './mount-cell';

const CELL = 'x $a$ yz';

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Show the widget's source and type into it: an edit that lives only in the DOM until something
 *  hides it again, exactly as the user's does. */
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
	// `insertRowBelow` rebuilds every row from the cell `.raw`, so an edit in a source still
	// showing is not merely uncommitted: it is gone, with no gesture left to recover it.
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

	// The commit-by-accident case: the toggle reads the shown DOM text and writes it back as the
	// cell's raw, leaving the source showing over bytes it no longer matches.
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

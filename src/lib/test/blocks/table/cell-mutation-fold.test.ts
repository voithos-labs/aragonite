// @vitest-environment jsdom
// Miss-analysis: hiding a shown source before a cell edit was tested on two of its paths only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { mountCell } from './mount-cell';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { settleEditor, dispatchKey } from '$lib/test/harness/settle';

const CELL = 'x $a$ yz';

/** Show the widget's source and type into it: an edit that lives only in the DOM until something
 *  hides it again, exactly as the user's does. */
async function revealAndEdit(el: HTMLElement, edited: string): Promise<void> {
	dispatchKey(el, { key: 'ArrowLeft' });
	await settleEditor();
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
		await settleEditor();

		const commits = vi.mocked(blockEdit.updateBlockContent).mock.calls;
		expect(commits.map((c) => trimTrailingLineEnding(c[1]))).toEqual(['x $a_n$ yz']);
		expect(tableContext.insertRowBelow).toHaveBeenCalledTimes(1);
		expect(vi.mocked(blockEdit.updateBlockContent).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(tableContext.insertRowBelow).mock.invocationCallOrder[0]
		);
	});

	// Without hiding the source first, the toggle reads the shown DOM text and writes it back as
	// the cell's raw, leaving the source showing over bytes it no longer matches.
	it('folds before a format toggle rather than committing the revealed text as raw', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);
		await revealAndEdit(el, '$a_n$');

		instance.runCommand('format.toggleStrong');
		await settleEditor();

		expect(trimTrailingLineEnding(vi.mocked(blockEdit.updateBlockContent).mock.calls[0][1])).toBe(
			'x $a_n$ yz'
		);
	});
});

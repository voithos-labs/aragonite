// @vitest-environment jsdom
// A cell command run while a widget's source is shown closes the source first, and acts on the
// selection the chord ran with, which the close would collapse.
// Miss-analysis: the toggle tests ran at a collapsed caret, where reading the selection after the
// close or before it gives the same range.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '#packages/latex/src/latex-kind.js';
import { mountCell } from './mount-cell';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { settleEditor, dispatchKey } from '#lib/test/harness/settle.js';

const CELL = 'x $a$ yz';

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('a cell command closes the shown source before it runs', () => {
	it('toggles the range selected when the chord ran, which closing the source collapses', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);
		dispatchKey(el, { key: 'ArrowLeft' });
		await settleEditor();
		expect(el.querySelector('[data-inline-widget]'), 'the source is not showing').toBeNull();
		instance.setSelection(0, 1);

		instance.runCommand('format.toggleStrong');
		await settleEditor();

		const writes = vi.mocked(blockEdit.updateBlockContent).mock.calls;
		expect(writes.map((c) => trimTrailingLineEnding(c[1]))).toEqual(['**x** $a$ yz']);
	});
});

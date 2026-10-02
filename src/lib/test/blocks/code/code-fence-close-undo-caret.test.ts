// @vitest-environment jsdom
// Miss-analysis: the fence-close tests read the replacement's bytes, never the undo caret, so the
// replace fell back to its landing offset in the new paragraph as where undo returns.
import { it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import { mountCode, type MountedCode } from './mount-code';

let mounted: MountedCode;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

it('Enter closing an unclosed fence records the caret it was pressed at as the undo caret', () => {
	mounted = mountCode('```js\ncode\n\n');
	const { el, instance } = mounted;
	el.focus();
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range);

	instance.runCommand('code.newline');

	const [, , , options] = vi.mocked(mounted.blockEdit.replaceBlock).mock.calls[0];
	expect(options).toEqual({ snapshotOffset: '```js\ncode\n'.length });
});

// @vitest-environment jsdom
//
// CodeBlock's insertLineBreak composition gate, driven through the mounted component's real
// listeners (the branch lives in the component, not an extracted helper): an IME emitting
// insertLineBreak mid-composition must not sync the CST; the same event after
// compositionend splices its newline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountCode, type MountedCode } from './mount-code';
import { settleEditor } from '$lib/test/harness/settle';

function lineBreak(): InputEvent {
	return new InputEvent('beforeinput', {
		inputType: 'insertLineBreak',
		bubbles: true,
		cancelable: true
	});
}

let mounted: MountedCode;

beforeEach(() => {
	mounted = mountCode('```\nhello\n```\n');
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock: insertLineBreak composition gate', () => {
	it('mid-composition insertLineBreak does not sync the CST', async () => {
		const { el, blockEdit } = mounted;
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(lineBreak());
		await settleEditor();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('post-composition insertLineBreak splices its newline', async () => {
		const { el, blockEdit } = mounted;
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		vi.mocked(blockEdit.updateBlockContent).mockClear(); // drop the commit from the end

		el.dispatchEvent(lineBreak());
		await settleEditor();

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newText] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newText).toContain('\n\nhello');
	});
});

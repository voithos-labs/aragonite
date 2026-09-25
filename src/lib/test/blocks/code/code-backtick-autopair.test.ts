// @vitest-environment jsdom
//
// A typed backtick at the mounted code block's own beforeinput listener: an unclosed backtick
// fence leaves it to the browser, since a partner would extend the opener; a closed fence pairs it.
// Miss-analysis: the pure pair decision was pinned with the fence flag handed in, so how the block
// derives that flag from its metadata had only e2e rows.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets } from '$lib/cursor/content-offsets';
import { mountCode, type MountedCode } from './mount-code';
import { settleEditor } from '$lib/test/harness/settle';

let mounted: MountedCode;

afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

async function typeBacktickAt(source: string, offset: number): Promise<InputEvent> {
	mounted = mountCode(source);
	const range = createRangeFromOffsets(
		mounted.el,
		asDomTextOffset(offset),
		asDomTextOffset(offset)
	);
	mounted.el.focus();
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range!);
	const e = new InputEvent('beforeinput', {
		inputType: 'insertText',
		data: '`',
		bubbles: true,
		cancelable: true
	});
	mounted.el.dispatchEvent(e);
	await settleEditor();
	return e;
}

describe('CodeBlock: backtick auto-pair against the fence', () => {
	it('leaves a fourth backtick on an unclosed opener to the browser', async () => {
		const e = await typeBacktickAt('```\n', 3);

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('leaves a backtick on the empty body line of an unclosed fence to the browser', async () => {
		const e = await typeBacktickAt('```\n\n', 4);

		expect(e.defaultPrevented).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('pairs a backtick inside a closed fence', async () => {
		const e = await typeBacktickAt('```\n\n```\n', 4);

		expect(e.defaultPrevented).toBe(true);
		const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toBe('```\n``\n```\n');
	});
});

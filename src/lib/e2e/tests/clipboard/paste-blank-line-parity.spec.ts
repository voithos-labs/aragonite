import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('a pasted blank line is the block a typed or loaded one is', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Enter separates, so the FIRST press already blank-line-separates the halves and
	// the second is what makes the empty block; its own line is the third newline.
	test('typed: an explicitly created empty block is a third block', async () => {
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
		await editor.typeText('one');
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('two');
		await editor.bridge.waitForSourceEquals('one\n\n\ntwo\n');

		const typedCount = await editor.getDomBlockCount();
		expect(typedCount).toBe(3);
		// The blocks the bytes reload as: the shape survives the round trip (issue #20).
		await editor.loadContent(await editor.bridge.getSource());
		expect(await editor.getDomBlockCount()).toBe(typedCount);
	});

	// Windows clipboard writes CRLF, so every source read normalizes before comparing.
	const asLf = (src: string) => src.replace(/\r\n/g, '\n').replace(/\s+$/, '');

	test('pasted: a lone blank-line separator stays a separator, as it does on load', async () => {
		await editor.loadContent('');
		await editor.seedClipboard('one\n\ntwo');
		await editor.focusBlockAtPath([0], 0);
		await editor.paste();
		await editor.bridge.waitForSourceContains('two');

		const pastedSource = asLf(await editor.bridge.getSource());
		const pastedCount = await editor.getDomBlockCount();
		expect(pastedSource).toBe('one\n\ntwo');
		expect(pastedCount).toBe(2);

		// Parity is the contract, so the loaded count is asserted against the pasted one
		// rather than against a second literal: either side drifting alone goes red.
		await editor.loadContent(pastedSource);
		expect(await editor.getDomBlockCount()).toBe(pastedCount);
	});

	test('pasted: a two-line blank run carries its empty block across the clipboard', async () => {
		await editor.loadContent('');
		await editor.seedClipboard('one\n\n\ntwo');
		await editor.focusBlockAtPath([0], 0);
		await editor.paste();
		await editor.bridge.waitForSourceContains('two');

		const pastedSource = asLf(await editor.bridge.getSource());
		const pastedCount = await editor.getDomBlockCount();
		expect(pastedSource).toBe('one\n\n\ntwo');
		expect(pastedCount).toBe(3);

		await editor.loadContent(pastedSource);
		expect(await editor.getDomBlockCount()).toBe(pastedCount);
	});

	// Finding 7.6: a mid-paragraph structural paste lands the caret at the end of
	// the pasted content, not the trailing residue. Typing appends to the paste.
	test('mid-paragraph multi-block paste lands the caret at the end of the pasted content', async () => {
		await editor.loadContent('helloworld\n');
		await editor.seedClipboard('one\n\ntwo');
		await editor.focusBlockAtPath([0], 5); // between "hello" and "world"
		await editor.paste();
		await editor.bridge.waitForSourceContains('two');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('twoZ');

		const src = await editor.bridge.getSource();
		expect(src).toContain('twoZ');
		expect(src).not.toContain('worldZ');
	});
});

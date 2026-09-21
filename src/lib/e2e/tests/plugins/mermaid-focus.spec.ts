import { test, expect } from '../../fixtures';
import { readDoc, waitForDoc, activeBlockPath, roundTripStable } from './helpers';
import { MERMAID_FENCE, MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

/**
 * Whole-block focus and the two-step delete for mermaid (requirements/plugins/mermaid-focus.md).
 * The diagram, which has no children, opts into `blockFocus: 'whole-block'`, so arrows stop on it,
 * a Backspace or Delete beside it focuses it before a second keypress deletes, Enter inserts a
 * paragraph below and Alt with the arrows reorders, all through real keyboard and mouse gestures.
 */

test.describe('mermaid whole-block focus', () => {
	let editor: MermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
	});

	test('ArrowUp from below focuses the block; a second ArrowUp exits to the block above', async ({
		page
	}) => {
		await editor.getBlock(2).click();
		await page.keyboard.press('ArrowUp');
		await expect(editor.inputHost).toBeFocused();
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([0]);
	});

	test('ArrowDown from the end of the block above focuses it; a second ArrowDown exits below', async ({
		page
	}) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowDown');
		await expect(editor.inputHost).toBeFocused();
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('ArrowDown');
		expect(await activeBlockPath(page)).toEqual([2]);
	});

	test('ArrowLeft at offset 0 below focuses the block; ArrowRight at the end above mirrors', async ({
		page
	}) => {
		await editor.getBlock(2).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(editor.inputHost).toBeFocused();

		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.inputHost).toBeFocused();
	});

	test('Backspace at offset 0 below focuses the block; a second Backspace deletes it; one undo restores it', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();

		await editor.getBlock(2).click();
		await page.keyboard.press('Home');
		await editor.pressDeclined('Backspace');
		await expect(editor.inputHost).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(original); // focus only — no byte change, no undo entry

		await page.keyboard.press('Backspace');
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid'));
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'paragraph']);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(original); // one undo restores it byte-exactly
	});

	test('Delete at the end of the block above focuses it; a second Delete deletes it (forward twin)', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();

		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await editor.pressDeclined('Delete');
		await expect(editor.inputHost).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(original);

		await page.keyboard.press('Delete');
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid'));
	});

	// The plugin container's own handling of global chords. No inner block handles them here and
	// the editor root declines while the box holds focus, so this block is the only thing between
	// the keypress and the browser's own undo, which would rewrite the document behind the undo
	// stack. Rebinding proves it reads the consumer's overrides and not just the built-in table:
	// a consumer's `Mod+Alt+U` reaches every other block and has to reach this one too.
	test('undo fires while the diagram holds focus, built-in chord and rebind alike', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('textZ');

		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals(original);

		await page.evaluate(() =>
			(window as any).__test.setKeybindings([{ chord: 'Mod+Alt+U', command: 'history.undo' }])
		);
		await page.keyboard.type('Q');
		await editor.bridge.waitForSourceContains('Q');
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('ControlOrMeta+Alt+u');
		await editor.bridge.waitForSourceEquals(original);
	});

	test('clicking the diagram then Backspace deletes the block', async ({ page }) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('Backspace');
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid'));
	});

	test('Backspace inside the edit textarea edits the draft and never deletes the block', async ({
		page
	}) => {
		await editor.viewport.dblclick();
		await expect(editor.textarea).toBeVisible();

		await page.keyboard.type('X');
		await page.keyboard.press('Backspace');
		// The block survives; a deleted block would unmount the textarea.
		await expect(editor.textarea).toBeVisible();
		expect((await readDoc(page)).kinds).toContain('mermaid');
	});

	test('Enter while focused inserts an empty paragraph below with the caret in it', async ({
		page
	}) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('Enter');

		await waitForDoc(page, (s) => s.rootCount === 4);
		const doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph']);
		expect(doc.texts[2]).toBe(''); // the new empty paragraph, below the diagram
		expect(await activeBlockPath(page)).toEqual([2]);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a typed character while focused mints a paragraph below carrying it', async ({ page }) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('x');

		await waitForDoc(page, (s) => s.rootCount === 4);
		const doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph']);
		expect(doc.texts[2]).toBe('x');
		expect(await activeBlockPath(page)).toEqual([2]);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('Alt+ArrowDown reorders the block down; Alt+ArrowUp moves it back', async ({ page }) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();

		await page.keyboard.press('Alt+ArrowDown');
		await waitForDoc(page, (s) => s.kinds[2] === 'mermaid');
		let doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'paragraph', 'mermaid']);
		expect([doc.texts[0], doc.texts[1]]).toEqual(['Above text', 'tail text']);
		await expect(editor.inputHost).toBeFocused(); // the reorder keeps the block focused

		await page.keyboard.press('Alt+ArrowUp');
		await waitForDoc(page, (s) => s.kinds[1] === 'mermaid');
		doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'mermaid', 'paragraph']);
		expect([doc.texts[0], doc.texts[2]]).toEqual(['Above text', 'tail text']);
	});

	// The container factory's share of whole-block copying: the gesture is handled once in
	// handleWholeBlockKeys, so mermaid gets Mod+C and Mod+X like the built-in thematic break,
	// pinned in clipboard/whole-block-atomic-copy. navigator.clipboard.writeText rewrites line
	// endings to the operating system's, CRLF on Windows, and the block markdown is written with
	// LF, so the comparison normalizes to LF.
	const readClipboardLF = () => editor.readClipboard().then((t) => t.replaceAll('\r\n', '\n'));

	test('Mod+C while focused copies the diagram markdown; the document is unchanged', async ({
		page
	}) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();
		expect(await readClipboardLF()).toBe(MERMAID_FENCE);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Mod+X while focused copies the markdown and deletes the block; one undo restores it', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('ControlOrMeta+x');
		await editor.waitForClipboardWrite();
		expect(await readClipboardLF()).toBe(MERMAID_FENCE);
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid'));
		await editor.undo();
		await editor.bridge.waitForSourceEquals(original);
	});
});

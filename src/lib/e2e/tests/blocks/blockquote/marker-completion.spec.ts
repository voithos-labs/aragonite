import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: e2e/requirements/blocks/blockquote/marker-completion.md.

/** An empty paragraph below `lead`, made by a real Enter — the mint path a load never runs. */
async function emptyParagraphBelowLead(editor: EditorPage): Promise<void> {
	await editor.loadContent('lead\n');
	await editor.focusBlockEnd(0);
	await editor.page.keyboard.press('Enter');
	await editor.waitForBlockHostCount(2);
}

/** Type `>` and settle on the mint: the source carries the marker and the caret has moved
 *  into the quote's child, so the next keystroke cannot race the reclassify. */
async function typeQuoteOpener(editor: EditorPage, depth: number): Promise<void> {
	await editor.typeText('>');
	await editor.bridge.waitForSourceMatches(new RegExp(`^${'> '.repeat(depth - 1)}>`, 'm'));
	await expect
		.poll(async () => (await editor.bridge.getSelectionPaths())?.focus.path.length ?? 0)
		.toBeGreaterThanOrEqual(depth + 1);
}

/** The marker-completion press: consumed, so not one byte of the document moves. */
async function pressMarkerSpace(editor: EditorPage): Promise<void> {
	const before = await editor.bridge.getSource();
	await editor.page.keyboard.press('Space');
	await editor.waitForNoSourceMutation();
	expect(await editor.bridge.getSource()).toBe(before);
}

test.describe('blockquote — the space that completes the `> ` marker', () => {
	let editor: EditorPage;

	test('live: `>` then space then `a` yields `> a`, and the space moves no byte', async ({
		page
	}) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await emptyParagraphBelowLead(editor);

		await typeQuoteOpener(editor, 1);
		await pressMarkerSpace(editor);
		await editor.typeText('a');

		await editor.bridge.waitForSourceMatches(/^> a$/m);
		expect(await editor.bridge.getSource()).not.toContain('>  ');
	});

	test('source: the same three keystrokes yield `> a`', async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await emptyParagraphBelowLead(editor);

		await typeQuoteOpener(editor, 1);
		await pressMarkerSpace(editor);
		await editor.typeText('a');

		await editor.bridge.waitForSourceMatches(/^> a$/m);
		expect(await editor.bridge.getSource()).not.toContain('>  ');
	});

	test('a nested quote completes at its own depth', async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await emptyParagraphBelowLead(editor);

		await typeQuoteOpener(editor, 1);
		await pressMarkerSpace(editor);
		await typeQuoteOpener(editor, 2);
		await pressMarkerSpace(editor);
		await editor.typeText('a');

		await editor.bridge.waitForSourceMatches(/^> > a$/m);
		expect(await editor.bridge.getSource()).not.toContain('>  ');
	});

	test('the empty child an Enter makes completes the same way', async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('> Line one\n');
		const inner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await inner.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/> Line one\n>\n>\n$/);

		await pressMarkerSpace(editor);
		await editor.typeText('x');

		await editor.bridge.waitForSourceMatches(/^> x$/m);
		expect(await editor.bridge.getSource()).not.toContain('>  ');
	});

	test('a space at offset 0 of a NON-empty quote child is ordinary content', async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('> abc\n');
		const inner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await inner.click();
		await page.keyboard.press('Home');

		await page.keyboard.press('Space');

		await editor.bridge.waitForSourceContains('>  abc');
		expect(await editor.bridge.getSource()).toContain('>  abc');
	});
});

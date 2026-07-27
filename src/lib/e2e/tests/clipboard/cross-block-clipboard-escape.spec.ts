import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A cross-block clipboard gesture whose event lands on `document.body` rather than
// on a block surface (requirements/clipboard/cross-block-clipboard-escape.md). The
// trigger is a focus endpoint that hosts no caret: the selection seam's park is a
// no-op there, and Chromium retargets the clipboard event to the body.

const IMAGE_ONLY_DOC = 'first para\n\nsecond para\n\n![cat](/test-fixtures/sample.png)\n';
const RULE_DOC = 'first para\n\nsecond para\n\n---\n';

test.describe('cross-block clipboard with a caret-less focus endpoint', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const readClipboard = () => editor.page.evaluate(() => navigator.clipboard.readText());
	const seedClipboard = (text: string) =>
		editor.page.evaluate((t) => navigator.clipboard.writeText(t), text);

	async function selectWholeDocument(): Promise<void> {
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
	}

	test('Ctrl+C copies the document when the last block is an image', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await seedClipboard('UNTOUCHED');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await readClipboard();
		expect(clip).toContain('first para');
		expect(clip).toContain('second para');
		expect(clip).toContain('sample.png');
	});

	test('Ctrl+C copies the document when the last block is a thematic break', async () => {
		await editor.loadContent(RULE_DOC);
		await seedClipboard('UNTOUCHED');
		await editor.focusBlockStart(0);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		expect(await readClipboard()).toContain('first para');
	});

	test('Ctrl+X copies the document and empties it', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await seedClipboard('UNTOUCHED');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();
		await editor.bridge.waitForSourceNotContains('first para');

		expect(await readClipboard()).toContain('first para');
		expect(await editor.bridge.getSource()).not.toContain('second para');
	});

	test('Ctrl+V replaces the selection', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await seedClipboard('replacement text');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('replacement text');

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('first para');
		expect(source).not.toContain('sample.png');
	});

	test('a copy a block surface does receive is still written once', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await seedClipboard('UNTOUCHED');
		await editor.focusBlockStart(0);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		expect(await readClipboard()).toBe('first para\n\nsecond para\n\nthird para');
	});
});

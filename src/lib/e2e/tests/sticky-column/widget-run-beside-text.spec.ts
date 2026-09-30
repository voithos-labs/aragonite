import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A run of entity widgets followed by text, all on one visual line: the widget edges and the
// text offer positions on the same line, and only the text's paint a caret.
// Requirements: `e2e/requirements/sticky-column/widget-run-beside-text.md`.

const PARAGRAPH = 'b'.repeat(40);
const RUN = '&copy;'.repeat(5);
const TRAILING = 'alpha beta gamma';
const DOC = `${PARAGRAPH}\n\n${RUN}${TRAILING}\n\n${PARAGRAPH}\n`;

async function arriveFromColumnZero(editor: EditorPage, from: number, key: string): Promise<void> {
	await editor.page.locator('[contenteditable="true"]').nth(from).click();
	await editor.page.keyboard.press('Home');
	await editor.waitForRenderFlush();
	await editor.page.keyboard.press(key);
	await editor.waitForRenderFlush();
	await editor.typeText('X');
}

test.describe('sticky column: a run of widgets followed by text on one line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	for (const [direction, from, key] of [
		['from above', 0, 'ArrowDown'],
		['from below', 2, 'ArrowUp']
	] as const) {
		test(`${direction}, a column left of the run lands in the text, not on a widget edge`, async () => {
			await arriveFromColumnZero(editor, from, key);
			const src = await editor.bridge.getSource();
			expect(src).toContain(`${RUN}X${TRAILING}`);
			expect(src).not.toContain(`X${RUN}`);
		});
	}
});

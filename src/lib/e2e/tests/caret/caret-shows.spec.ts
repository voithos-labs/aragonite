import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { drawnBar, expectBarBesideWidget } from '../../carets-showing';

// Requirements: `requirements/caret/caret-shows.md`. A caret written beside a picture shows as the
// drawn caret's bar, whatever route wrote it, and the next letter lands at that edge.

const IMG = '![x](/test-fixtures/sample.png)';
const LINKED = '[![alt](/test-fixtures/sample.png)](https://x.y)';

interface Row {
	name: string;
	source: string;
	side: 'before' | 'after';
	arrive: (editor: EditorPage, page: Page) => Promise<void>;
	typed: string;
}

const ROWS: Row[] = [
	{
		name: 'a caret put at a lone picture’s start',
		source: `${IMG}\n`,
		side: 'before',
		arrive: (editor) => editor.focusBlockStart(0),
		typed: `Q${IMG}`
	},
	{
		name: 'a caret put at a lone picture’s end',
		source: `${IMG}\n`,
		side: 'after',
		arrive: (editor) => editor.focusBlockEnd(0),
		typed: `${IMG}Q`
	},
	{
		name: 'a caret put at a linked picture’s start',
		source: `${LINKED}\n`,
		side: 'before',
		arrive: (editor) => editor.focusBlockStart(0),
		typed: `Q${LINKED}`
	},
	{
		name: 'a caret put at a linked picture’s end',
		source: `${LINKED}\n`,
		side: 'after',
		arrive: (editor) => editor.focusBlockEnd(0),
		typed: `${LINKED}Q`
	},
	{
		name: 'Backspace on an empty paragraph below a picture',
		source: `${IMG}\n\n\n\nafter\n`,
		side: 'after',
		arrive: async (editor, page) => {
			await editor.focusBlockStart(1);
			await page.keyboard.press('Backspace');
		},
		typed: `${IMG}Q\n\n\nafter`
	},
	{
		name: 'Backspace on an empty paragraph below a linked picture',
		source: `${LINKED}\n\n\n\nafter\n`,
		side: 'after',
		arrive: async (editor, page) => {
			await editor.focusBlockStart(1);
			await page.keyboard.press('Backspace');
		},
		typed: `${LINKED}Q\n\n\nafter`
	},
	{
		name: 'undo of a letter typed after a picture',
		source: `${IMG}\n\nafter\n`,
		side: 'after',
		arrive: async (editor, page) => {
			await editor.focusBlockEnd(0);
			await page.keyboard.type('Z');
			await expect.poll(() => editor.bridge.getSource()).toContain(`${IMG}Z`);
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => editor.bridge.getSource()).not.toContain('Z');
		},
		typed: `${IMG}Q\n\nafter`
	},
	{
		name: 'Enter after a picture, then Backspace',
		source: `${IMG}\n\nafter\n`,
		side: 'after',
		arrive: async (editor, page) => {
			await editor.focusBlockEnd(0);
			await page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockCount()).toBe(3);
			await page.keyboard.press('Backspace');
		},
		typed: `${IMG}Q\n\nafter`
	}
];

test.describe('a caret written beside a picture shows', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const row of ROWS) {
		test(row.name, async ({ page }) => {
			await editor.loadContent(row.source);
			await row.arrive(editor, page);
			await expectBarBesideWidget(page, page.locator('[data-image-widget]'), 'image', row.side);
			await page.keyboard.type('Q');
			await expect.poll(async () => (await editor.bridge.getSource()).trimEnd()).toBe(row.typed);
		});
	}

	// A decoded entity sits in a line, where the browser draws its own caret, so the bar stays away.
	test('a caret put after an entity at a line’s end keeps the browser’s caret', async ({
		page
	}) => {
		await editor.loadContent('lead &copy;\n');
		await editor.focusBlockEnd(0);
		await editor.waitForRenderFlush();
		expect((await drawnBar(page))?.state ?? 'native').not.toBe('widget');
		await page.keyboard.type('Q');
		await expect.poll(async () => (await editor.bridge.getSource()).trimEnd()).toBe('lead &copy;Q');
	});
});

import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { extendKey } from '../../../platform-keys';
import { wholeBlockInput } from '../../../whole-block-input';
import type { PresentationMode } from '../../../../presentation-mode';

// Mod+A's steps, the block's text and then the document: a press whose step would change nothing
// takes the next one, so every press shows something.
// Requirements: `requirements/selection/keyboard/select-all-steps.md`.

interface Route {
	name: string;
	doc: string;
	/** Puts the caret or range down the way a user would, before the press. */
	arrive: (editor: EditorPage) => Promise<void>;
	/** The path the document step's focus lands on. */
	last: number[];
	/** Source mode shows a code fence's lines as text, which a first press selects. */
	liveOnly?: boolean;
}

/** Enter at the end of the leaf at `path`, which opens an empty one after it as a user makes one. */
async function enterAfter(editor: EditorPage, path: number[], length: number): Promise<void> {
	await editor.focusBlockAtPath(path, length);
	await editor.page.keyboard.press('Enter');
	await editor.waitForRenderFlush();
}

const NOTHING_TO_SELECT: Route[] = [
	{
		name: 'an empty paragraph',
		doc: 'alpha\n\nbeta\n',
		arrive: (editor) => enterAfter(editor, [0], 5),
		last: [2]
	},
	{
		name: 'an empty list item',
		doc: 'alpha\n\n- one\n\nbeta\n',
		arrive: (editor) => enterAfter(editor, [1, 0, 0], 3),
		last: [2]
	},
	{
		name: 'an empty quote line',
		doc: 'alpha\n\n>\n\nbeta\n',
		arrive: (editor) => editor.focusBlockAtPath([1, 0], 0),
		last: [2]
	},
	{
		name: 'an empty code body',
		doc: 'alpha\n\n```js\n\n```\n\nbeta\n',
		arrive: (editor) => editor.focusBlockAtPath([1], 6),
		last: [2],
		liveOnly: true
	},
	{
		name: 'a paragraph already wholly selected',
		doc: 'alpha\n\nbeta\n',
		arrive: async (editor) => {
			await editor.focusBlockEnd(0);
			await editor.page.keyboard.press(extendKey('lineStart'));
		},
		last: [1]
	}
];

async function expectWholeDocument(editor: EditorPage, last: number[]): Promise<void> {
	await editor.waitForCrossBlock(true);
	const sel = await editor.bridge.getSelectionPaths();
	expect(sel!.anchor).toEqual({ path: [0], offset: 0 });
	expect(sel!.focus.path).toEqual(last);
}

for (const mode of ['live', 'source'] as const satisfies readonly PresentationMode[]) {
	test.describe(`Mod+A where its first step changes nothing, ${mode} mode`, () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto(`?presentationMode=${mode}`);
		});

		for (const route of NOTHING_TO_SELECT.filter((r) => mode === 'live' || !r.liveOnly)) {
			test(`${route.name}: one press selects the document`, async ({ page }) => {
				await editor.loadContent(route.doc);
				await route.arrive(editor);
				await page.keyboard.press('ControlOrMeta+a');
				await expectWholeDocument(editor, route.last);
			});
		}
	});
}

test.describe('Mod+A from a block with no text of its own', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	test('an empty table cell: one press selects the document', async ({ page }) => {
		await editor.loadContent('above\n\n| a | b |\n| - | - |\n|   | x |\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await expectWholeDocument(editor, [1]);
	});

	test('a divider focused whole: one press selects the document', async ({ page }) => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await expect(wholeBlockInput(page.locator('.thematic-break-block'))).toBeFocused();
		await page.keyboard.press('ControlOrMeta+a');
		await expectWholeDocument(editor, [2]);
	});
});

test.describe('Mod+A where its first step selects something', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	test("a cell with text: the first press takes the cell's text, the second the document", async ({
		page
	}) => {
		await editor.loadContent('above\n\n| a | b |\n| - | - |\n| cat | x |\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('cat');
		expect(await editor.bridge.ownsRange()).toBe(false);
		await page.keyboard.press('ControlOrMeta+a');
		await expectWholeDocument(editor, [1]);
	});

	test("an image's paragraph: the first press takes the image, not the document", async ({
		page
	}) => {
		const image =
			'![alt](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)';
		await editor.loadContent(`alpha\n\n${image}\n\nbeta\n`);
		await editor.focusBlockEnd(1);
		await page.keyboard.press('ControlOrMeta+a');
		await expect
			.poll(() => editor.bridge.getSelection())
			.toEqual({ anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: image.length } });
	});
});

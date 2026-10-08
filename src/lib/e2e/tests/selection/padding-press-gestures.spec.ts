import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { nextRow } from '../presentation/helpers';
import { attachIme } from '../../simulation/ime';
import { pointAtRaw, pointInTopPadding, type Point } from '../../text-runs';

// Every other gesture that starts in an editable's top padding still works once the editor places
// a plain press there itself. Requirements: `e2e/requirements/selection/padding-press-gestures.md`.

const DOC =
	'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\nHello world\n\n| A | B |\n| --- | --- |\n| hello | x |\n';

const TARGETS = [
	// `con|st`, and `const x|` for a drag's end.
	{
		name: 'a code block',
		editable: "[data-block-path='[1]'] .code-block",
		path: [1],
		at: 9,
		to: 12,
		typed: 'conZst x = 1;'
	},
	// `Hel|lo`, and `Hello wor|ld`.
	{
		name: 'a paragraph',
		editable: "[data-block-path='[2]'] [contenteditable='true']",
		path: [2],
		at: 3,
		to: 9,
		typed: 'HelZlo world'
	}
];

// `hel|lo` in the body cell, which opens the table's own menu rather than the block menu.
const CELL = {
	name: 'a table cell',
	editable: '.table-cell >> nth=2',
	path: [3, 1, 0],
	at: 3,
	to: 5,
	typed: '| helZlo |'
};

type Target = (typeof TARGETS)[number];

async function open(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?presentationMode=live');
	await editor.loadContent(DOC);
	return editor;
}

async function paddingAbove(page: Page, target: Target): Promise<{ line: Point; padding: Point }> {
	const line = await pointAtRaw(page, target.path, target.at);
	return { line, padding: await pointInTopPadding(page.locator(target.editable), line.x) };
}

/** Clicks `clickCount` times at `point` and reports the selection that leaves. */
async function multiClick(editor: EditorPage, point: Point, clickCount: number) {
	await editor.page.mouse.click(point.x, point.y, { clickCount });
	await editor.waitForRenderFlush();
	return editor.bridge.getSelectionPaths();
}

for (const target of TARGETS) {
	test(`gestures that start in the top padding of ${target.name} still work`, async ({ page }) => {
		const editor = await open(page);

		for (const [clicks, name] of [
			[2, 'double-click'],
			[3, 'triple-click']
		] as const) {
			await test.step(`a ${name} selects what it does on the line`, async () => {
				await nextRow(editor, DOC);
				const { line, padding } = await paddingAbove(page, target);
				const onLine = await multiClick(editor, line, clicks);
				await editor.focusBlockEnd(0);

				expect(await multiClick(editor, padding, clicks)).toEqual(onLine);
			});
		}

		await test.step('a drag selects from the column below', async () => {
			await nextRow(editor, DOC);
			const { padding } = await paddingAbove(page, target);
			const end = await pointAtRaw(page, target.path, target.to);

			await page.mouse.move(padding.x, padding.y);
			await page.mouse.down();
			await page.mouse.move(end.x, end.y, { steps: 8 });
			await page.mouse.up();

			await expect
				.poll(() => editor.bridge.getSelectionPaths())
				.toEqual({
					anchor: { path: target.path, offset: target.at },
					focus: { path: target.path, offset: target.to }
				});
		});

		await test.step('a right-click leaves the caret at the column', async () => {
			await nextRow(editor, DOC);
			const { padding } = await paddingAbove(page, target);

			await page.mouse.click(padding.x, padding.y, { button: 'right' });
			await expect(page.getByRole('menu')).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(page.getByRole('menu')).toHaveCount(0);
			await page.keyboard.type('Z');

			await expect.poll(() => editor.bridge.getSource()).toContain(target.typed);
		});

		await test.step('composing after a click writes at the column', async () => {
			await nextRow(editor, DOC);
			const { padding } = await paddingAbove(page, target);
			const ime = await attachIme(page);

			await page.mouse.click(padding.x, padding.y);
			await ime.compose('あ');
			await ime.commit('あ');

			await expect.poll(() => editor.bridge.getSource()).toContain(target.typed.replace('Z', 'あ'));
		});
	});
}

// A right-click moves the caret before its menu opens, as a click would; Escape keeps it there.
test('a right-click in the top padding of a table cell leaves the caret at the column', async ({
	page
}) => {
	const editor = await open(page);
	const { padding } = await paddingAbove(page, CELL);

	await page.mouse.click(padding.x, padding.y, { button: 'right' });
	await expect(page.getByRole('menu')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
	await page.keyboard.type('Z');

	await expect.poll(() => editor.bridge.getSource()).toContain(CELL.typed);
});

test.describe('a tap', () => {
	test.use({ hasTouch: true });

	test('in the top padding of a code block and a paragraph lands at the column below', async ({
		page
	}) => {
		const editor = await open(page);

		for (const target of TARGETS) {
			await test.step(target.name, async () => {
				await nextRow(editor, DOC);
				const { padding } = await paddingAbove(page, target);

				await page.touchscreen.tap(padding.x, padding.y);

				const at = { path: target.path, offset: target.at };
				await expect
					.poll(() => editor.bridge.getSelectionPaths())
					.toEqual({ anchor: at, focus: at });
			});
		}
	});
});

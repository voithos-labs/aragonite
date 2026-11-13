import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// A new line made beside a to-do list and filled with a to-do joins the list, whichever gesture
// fills it: the bytes lose the blank line, a reload reads one list, and the undo entry that wrote
// the join brings the blank line back.
// Requirements: `e2e/requirements/blocks/list/fill-joins-list.md`.

const LIST = '- [ ] fold laundry\n- [ ] move email\n';
const LONG_LIST = Array.from({ length: 150 }, (_, i) => `- [ ] item ${i}\n`).join('');

interface Gesture {
	name: string;
	query?: '?slash=on';
	source: string;
	/** Makes the line and fills it, leaving the caret after `start`. */
	fill(editor: EditorPage, page: Page): Promise<void>;
	joined: string;
	/** The joined list's top-level index. */
	list: number;
	/** The bytes after each Ctrl+Z, down to the entry that wrote the join. */
	undos: string[];
}

const enterAfterIntro = async (editor: EditorPage, page: Page) => {
	await editor.focusBlockEnd(0);
	await page.keyboard.press('Enter');
};

const typeUnder = async (editor: EditorPage, page: Page) => {
	await editor.focusBlockStart(1);
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.type('- [ ] start');
};

const GESTURES: Gesture[] = [
	{
		name: 'typing a to-do on a new line over the list',
		source: `intro\n${LIST}`,
		async fill(editor, page) {
			await enterAfterIntro(editor, page);
			await page.keyboard.type('- [ ] start');
		},
		joined: `intro\n\n- [ ] start\n${LIST}`,
		list: 1,
		undos: [`intro\n\n- \n${LIST}`, `intro\n\n\n${LIST}`]
	},
	{
		name: 'typing a to-do on a new line under the list',
		source: `${LIST}\nafter\n`,
		fill: typeUnder,
		joined: `${LIST}- [ ] start\n\nafter\n`,
		list: 0,
		undos: [`${LIST}- \n\nafter\n`, `${LIST}\n\nafter\n`]
	},
	{
		name: 'typing a to-do on a new line under a list too long to draw whole',
		source: `${LONG_LIST}\nafter\n`,
		fill: typeUnder,
		joined: `${LONG_LIST}- [ ] start\n\nafter\n`,
		list: 0,
		undos: [`${LONG_LIST}- \n\nafter\n`, `${LONG_LIST}\n\nafter\n`]
	},
	{
		name: 'the slash menu to-do row on a new line over the list',
		query: '?slash=on',
		source: `intro\n${LIST}`,
		async fill(editor, page) {
			await enterAfterIntro(editor, page);
			await page.keyboard.type('/todo');
			await expect(page.getByRole('option', { name: /To-do list/ })).toBeVisible();
			await page.keyboard.press('Enter');
			await page.keyboard.type('start');
		},
		joined: `intro\n\n- [ ] start\n${LIST}`,
		list: 1,
		undos: [`intro\n\n- [ ] \n${LIST}`, `intro\n\n/todo\n\n${LIST}`]
	},
	{
		name: 'a to-do pasted on a new line over the list',
		source: `intro\n${LIST}`,
		async fill(editor, page) {
			await enterAfterIntro(editor, page);
			await editor.seedClipboard('- [ ] start\n');
			await editor.paste();
		},
		joined: `intro\n\n- [ ] start\n${LIST}`,
		list: 1,
		undos: [`intro\n\n\n${LIST}`]
	},
	{
		name: 'the right-click Insert block to-do row over the list',
		source: `intro\n\n${LIST}`,
		async fill(editor, page) {
			await page.getByText('intro').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Insert block' }).hover();
			await page.getByRole('menuitem', { name: 'To-do list' }).click();
			await page.keyboard.type('start');
		},
		joined: `intro\n\n- [ ] start\n${LIST}`,
		list: 1,
		undos: [`intro\n\n- [ ] \n${LIST}`, `intro\n\n${LIST}`]
	}
];

/** How far down each item's first line starts from the one before it, top to bottom. */
async function itemSteps(page: Page, list: number): Promise<number[]> {
	return page.evaluate((at) => {
		const probe = (window as any).__test;
		const tops: number[] = [];
		for (let i = 0; i < 3; i++) tops.push(probe.rects.rangeRects([at, i, 0], 0, 1)[0].top);
		return tops.slice(1).map((top, i) => Math.round(top - tops[i]));
	}, list);
}

test.describe('a to-do filled beside a to-do list joins it', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const gesture of GESTURES) {
			test(`${mode}: ${gesture.name}`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto(gesture.query ?? '');
				await editor.setPresentationMode(mode);
				await editor.loadContent(gesture.source);

				await gesture.fill(editor, page);
				await editor.bridge.waitForSourceEquals(gesture.joined);
				expect(await editor.parseConverged()).toBe(true);
				// The caret stayed in the new item: the key after the fill lands in its text.
				await page.keyboard.type('!');
				await editor.bridge.waitForSourceContains('- [ ] start!\n');
				await page.keyboard.press('Backspace');
				await editor.bridge.waitForSourceEquals(gesture.joined);

				await editor.loadContent(gesture.joined);
				expect(await editor.bridge.getBlockKind(gesture.list)).toBe('list');
				const steps = await itemSteps(page, gesture.list);
				expect(steps[0]).toBe(steps[1]);

				await editor.loadContent(gesture.source);
				await gesture.fill(editor, page);
				await editor.bridge.waitForSourceEquals(gesture.joined);
				for (const bytes of gesture.undos) {
					await editor.undo();
					await editor.bridge.waitForSourceEquals(bytes);
				}
			});
		}
	}
});

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { openTouch } from '../../touch';
import { attachIme } from '../../simulation/ime';

// Typing over a long-pressed word writes what typing over a mouse's word writes. Requirements:
// `e2e/requirements/selection/finger-word-typed.md`.

test.use({ hasTouch: true });

async function fingerWord(page: Page, editor: EditorPage, path: number[], at: number) {
	const point = await pointAtRaw(page, path, at);
	await page.touchscreen.tap(point.x, point.y);
	await page.touchscreen.tap(point.x, point.y);
	await expect.poll(() => editor.bridge.ownsRange()).toBe(true);
}

const ROWS = [
	{
		name: 'a heading',
		source: '# head\n\nnext\n',
		at: 4,
		modes: ['source', 'live'],
		typed: '# Q\n\nnext\n'
	},
	{ name: 'a bold run', source: 'a **bold** c\n', at: 6, modes: ['live'], typed: 'a **Q** c\n' },
	{
		name: 'a setext heading',
		source: 'heading\n====\n\nnext\n',
		at: 3,
		modes: ['source', 'live'],
		typed: 'Q\n====\n\nnext\n'
	}
] as const;

for (const row of ROWS)
	for (const mode of row.modes)
		test(`a key over a finger's word in ${row.name} keeps its markers, ${mode}`, async ({
			page
		}) => {
			const editor = await openTouch(page, row.source);
			await editor.setPresentationMode(mode);
			await fingerWord(page, editor, [0], row.at);
			await page.keyboard.type('Q');
			await editor.bridge.waitForSourceEquals(row.typed);
		});

test("a composition over a finger's word in a heading keeps the heading, live", async ({
	page
}) => {
	const editor = await openTouch(page, '# head\n\nnext\n');
	await editor.setPresentationMode('live');
	await fingerWord(page, editor, [0], 4);
	const ime = await attachIme(page);
	await ime.compose('か');
	await ime.commit('漢');
	await editor.bridge.waitForSourceEquals('# 漢\n\nnext\n');
});

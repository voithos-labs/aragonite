import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';
import { edgeKey } from '../../platform-keys';

/**
 * A fenced block's fence lines (requirements/plugins/fence-lines.md): the built-in code block and a
 * plugin's `%%%` block take clicks and arrows on the same lines, in source and live mode. Seed
 * `fence-lines`: `before`, a code block, `between`, the `%%%` block, `after`. Each landing is
 * `[path]@offset`; a click is named by its row (a quarter of the text's height) and side.
 */

const BLOCKS = { 'code block': 1, '%%% block': 3 } as const;

// Live mode hides the fence lines, so a click above the body lands on its first line.
// prettier-ignore
const LANDS: Record<'source' | 'live', Record<keyof typeof BLOCKS, string[]>> = {
	source: {
		'code block': [
			'0.125L [1]@0', '0.125R [1]@5', '0.375L [1]@6', '0.375R [1]@16',
			'0.625L [1]@17', '0.625R [1]@28', '0.875L [1]@29', '0.875R [1]@32',
			'down [1]@11', 'down [1]@22', 'down [1]@32', 'down [2]@6', 'down [3]@3',
			'up [1]@17', 'up [1]@6', 'up [1]@0', 'up [0]@0', 'up [0]@0',
			'end [0]@6', 'start [0]@0'
		],
		'%%% block': [
			'0.125L [3]@1', '0.125R [3]@3', '0.375L [3]@5', '0.375R [3]@14',
			'0.625L [3]@16', '0.625R [3]@26', '0.875L [3]@28', '0.875R [3]@30',
			'down [3]@3', 'down [3]@7', 'down [3]@18', 'down [3]@30', 'down [4]@5',
			'up [3]@27', 'up [3]@15', 'up [3]@4', 'up [3]@0', 'up [2]@0',
			'end [2]@7', 'start [2]@0'
		]
	},
	live: {
		'code block': [
			'0.125L [1]@6', '0.125R [1]@16', '0.375L [1]@6', '0.375R [1]@16',
			'0.625L [1]@17', '0.625R [1]@28', '0.875L [1]@17', '0.875R [1]@28',
			'down [1]@11', 'down [1]@22', 'down [2]@6', 'down [3]@10', 'down [3]@21',
			'up [1]@17', 'up [1]@6', 'up [0]@0', 'up [0]@0', 'up [0]@0',
			'end [0]@6', 'start [0]@0'
		],
		'%%% block': [
			'0.125L [3]@5', '0.125R [3]@14', '0.375L [3]@5', '0.375R [3]@14',
			'0.625L [3]@16', '0.625R [3]@26', '0.875L [3]@16', '0.875R [3]@26',
			'down [3]@11', 'down [3]@22', 'down [4]@5', 'down [5]@15', 'down [5]@21',
			'up [3]@15', 'up [3]@4', 'up [2]@0', 'up [1]@17', 'up [1]@6',
			'end [1]@16', 'start [1]@6'
		]
	}
};

/** The caret's block and offset, or null with no caret. */
async function caret(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const selection = (window as any).__test.getSelection();
		return selection ? `${JSON.stringify(selection.focus.path)}@${selection.focus.offset}` : null;
	});
}

/** Clicks across the block's text box, a column each side, a row per quarter of its height. */
async function clicks(page: Page, path: number): Promise<string[]> {
	const text = page.locator(`[data-block-path="[${path}]"] [contenteditable="true"]`).first();
	const box = (await text.boundingBox())!;
	const landed: string[] = [];
	for (const row of [0.125, 0.375, 0.625, 0.875]) {
		for (const [side, x] of [
			['L', box.x + 12],
			['R', box.x + box.width - 8]
		] as const) {
			await page.mouse.click(x, box.y + box.height * row);
			landed.push(`${row}${side} ${await caret(page)}`);
		}
	}
	return landed;
}

/** The caret walked down from the line above the block, up from the line below it, then to the
 *  ends of the line the walk ends on. */
async function walks(page: Page, path: number): Promise<string[]> {
	const landed: string[] = [];
	await page.evaluate((p) => (window as any).__test.placeCaret([p - 1], 'end'), path);
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('ArrowDown');
		landed.push(`down ${await caret(page)}`);
	}
	await page.evaluate((p) => (window as any).__test.placeCaret([p + 1], 'start'), path);
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('ArrowUp');
		landed.push(`up ${await caret(page)}`);
	}
	await page.keyboard.press(edgeKey('lineEnd'));
	landed.push(`end ${await caret(page)}`);
	await page.keyboard.press(edgeKey('lineStart'));
	landed.push(`start ${await caret(page)}`);
	return landed;
}

for (const mode of ['source', 'live'] as const) {
	for (const [name, path] of Object.entries(BLOCKS) as [keyof typeof BLOCKS, number][]) {
		test(`${name} in ${mode} mode: a click and an arrow land on the line they aim at`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('fence-lines');
			await editor.setPresentationMode(mode);
			expect([...(await clicks(page, path)), ...(await walks(page, path))]).toEqual(
				LANDS[mode][name]
			);
			expect(await capturedErrors(page)).toEqual([]);
		});
	}
}

import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';
import { edgeKey } from '../../platform-keys';

/**
 * A fenced block's fence lines (requirements/plugins/fence-lines.md): the built-in code block and a
 * plugin's `%%%` block take clicks and arrows on the same lines, in source and live mode. Seed
 * `fence-lines`: `before`, a code block, `between`, the `%%%` block, `after`. Each landing is
 * `[path]@offset`; a click is named by the painted line it aims at, counted from 1, and its side.
 */

const BLOCKS = { 'code block': 1, '%%% block': 3 } as const;

// Live mode hides the fence lines, so every click lands on the body. The `%%%` text has no padding.
// prettier-ignore
const LANDS: Record<'source' | 'live', Record<keyof typeof BLOCKS, string[]>> = {
	source: {
		'code block': [
			'1L [1]@0', '1R [1]@5', '2L [1]@6', '2R [1]@16',
			'3L [1]@17', '3R [1]@28', '4L [1]@29', '4R [1]@32',
			'topL [1]@0', 'topR [1]@5', 'bottomL [1]@29', 'bottomR [1]@32',
			'down [1]@6', 'down [1]@17', 'down [1]@29', 'down [2]@0',
			'up [1]@17', 'up [1]@6', 'up [1]@0', 'up [0]@0', 'up [0]@0',
			'end [0]@6', 'start [0]@0'
		],
		'%%% block': [
			'1L [3]@0', '1R [3]@3', '2L [3]@4', '2R [3]@14',
			'3L [3]@15', '3R [3]@26', '4L [3]@27', '4R [3]@30',
			'down [3]@0', 'down [3]@4', 'down [3]@15', 'down [3]@27',
			'up [3]@27', 'up [3]@15', 'up [3]@4', 'up [3]@0', 'up [2]@0',
			'end [2]@7', 'start [2]@0'
		]
	},
	live: {
		'code block': [
			'1L [1]@6', '1R [1]@16', '2L [1]@17', '2R [1]@28',
			'topL [1]@6', 'topR [1]@16', 'bottomL [1]@17', 'bottomR [1]@28',
			'down [1]@6', 'down [1]@17', 'down [2]@0', 'down [3]@4',
			'up [1]@17', 'up [1]@6', 'up [0]@0', 'up [0]@0', 'up [0]@0',
			'end [0]@6', 'start [0]@0'
		],
		'%%% block': [
			'1L [3]@4', '1R [3]@14', '2L [3]@15', '2R [3]@26',
			'down [3]@4', 'down [3]@15', 'down [4]@0', 'down [5]@8',
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

/** The lines the text paints, top first, and the middle of its top and bottom padding (null under
 *  2px), read off the text's own boxes so no font's line height moves an aim onto a neighbour. */
async function layout(page: Page, path: number) {
	return page.evaluate((p) => {
		const text = document.querySelector<HTMLElement>(
			`[data-block-path="[${p}]"] [contenteditable="true"]`
		)!;
		const range = document.createRange();
		range.selectNodeContents(text);
		const lines: { top: number; bottom: number; left: number; right: number }[] = [];
		for (const box of range.getClientRects()) {
			if (box.height === 0) continue;
			const middle = (box.top + box.bottom) / 2;
			const line = lines.find((l) => middle > l.top && middle < l.bottom);
			if (line) {
				line.left = Math.min(line.left, box.left);
				line.right = Math.max(line.right, box.right);
			} else lines.push({ top: box.top, bottom: box.bottom, left: box.left, right: box.right });
		}
		const frame = text.getBoundingClientRect();
		const style = getComputedStyle(text);
		const padTop = parseFloat(style.paddingTop);
		const padBottom = parseFloat(style.paddingBottom);
		const borderBottom = parseFloat(style.borderBottomWidth);
		return {
			lines: lines
				.sort((a, b) => a.top - b.top)
				.map((l) => ({ y: (l.top + l.bottom) / 2, left: l.left, right: l.right })),
			top: padTop < 2 ? null : frame.top + text.clientTop + padTop / 2,
			bottom: padBottom < 2 ? null : frame.bottom - borderBottom - padBottom / 2
		};
	}, path);
}

/** A click on each painted line, a pixel inside its first glyph and its last; then in the padding
 *  above the first line and below the last, level with those glyphs. */
async function clicks(page: Page, path: number): Promise<string[]> {
	const { lines, top, bottom } = await layout(page, path);
	const aims = [
		...lines.map((line, i) => ({ ...line, name: `${i + 1}` })),
		...(top === null ? [] : [{ ...lines[0], y: top, name: 'top' }]),
		...(bottom === null ? [] : [{ ...lines[lines.length - 1], y: bottom, name: 'bottom' }])
	];
	const landed: string[] = [];
	for (const aim of aims) {
		for (const [side, x] of [
			['L', aim.left + 1],
			['R', aim.right - 1]
		] as const) {
			await page.mouse.click(x, aim.y);
			landed.push(`${aim.name}${side} ${await caret(page)}`);
		}
	}
	return landed;
}

/** The caret walked down from the line above the block and up from the line below it, both from
 *  column 0 so no landing hangs on a font's widths, then to the ends of the line the walk ends on. */
async function walks(page: Page, path: number): Promise<string[]> {
	const landed: string[] = [];
	await page.evaluate((p) => (window as any).__test.placeCaret([p - 1], 'start'), path);
	// Four steps down, short of the `%%plain` block's closing line, which no row here reads.
	for (let i = 0; i < 4; i++) {
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

test('```math typed key by key in live mode keeps the caret off its info line', async ({
	page
}) => {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('fence-lines');
	await editor.setPresentationMode('live');
	await page.evaluate(() => (window as any).__test.placeCaret([4], 'end'));
	await page.keyboard.press('Enter');
	const landed: { key: string; kind: string; offset: number | null }[] = [];
	for (const key of ['`', '`', '`', 'm', 'a', 't', 'h', 'Enter', 'x']) {
		await page.keyboard.press(key);
		landed.push({
			key,
			...(await page.evaluate(() => {
				const selection = (window as any).__test.getSelection();
				const at = selection?.focus.path[0] ?? 5;
				return {
					kind: (window as any).__test.getBlockKind(at) as string,
					offset: selection ? (selection.focus.offset as number) : null
				};
			}))
		});
	}
	const typedInto = landed.filter((row) => row.kind === 'fence-lines/math');
	expect(typedInto.map((row) => row.key)).toEqual(['Enter', 'x']);
	// Past "```math\n", the info line and its ending.
	for (const row of typedInto) expect(row.offset).toBeGreaterThanOrEqual(8);

	await page.evaluate(() => (window as any).__test.placeCaret([0], 'end'));
	await expect.poll(() => editor.bridge.getSource()).toContain('\nafter\n\n```math\nx\n```\n');
	expect(await capturedErrors(page)).toEqual([]);
});

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { edgeKey, extendKey } from '../../platform-keys';

/**
 * Where a caret arriving on a `:::` container's opener row rests in live mode: at the title's
 * start (the row's end when untitled), never before or between the colons, whatever put it down
 * (`browser/offsets.ts :: arrivalRawStart`). One row per arrival route, then the routes left as
 * they were: a step, a selection, source mode, a restore, a `<details>` summary.
 */

const T = ':::tip Title\nbody\n:::\n';
const U = ':::tip\nbody\n:::\n';
const ABOVE = 'above\n\n:::tip Title\nbody\n:::\n';
const NEST = '::::note Outer\n:::tip Inner\nin\n:::\n::::\n';
const DETAILS = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

type Step =
	| { at: [number[], number] }
	| { key: string }
	| { type: string }
	| { click: 'left' | 'far-left' | 'padding' | 'right-click'; row?: number[] }
	| { mode: 'source' | 'live' };

interface Row {
	name: string;
	source: string;
	mode?: 'source' | 'live';
	seed?: string;
	steps: Step[];
	caret: string;
	bytes?: string;
}

const arrowBack = (n: number): Step[] => [
	{ at: [[0, 1], 0] },
	...Array.from({ length: n + 1 }, () => ({ key: 'ArrowLeft' }))
];

const ARRIVALS: Row[] = [
	{
		name: 'Home from the title',
		source: T,
		steps: [...arrowBack(2), { key: edgeKey('lineStart') }, { type: 'x' }],
		caret: '[0,0]:8',
		bytes: ':::tip xTitle\nbody\n:::\n'
	},
	{
		name: 'Home from inside the name',
		source: T,
		steps: [...arrowBack(7), { key: edgeKey('lineStart') }],
		caret: '[0,0]:7'
	},
	{
		name: 'Home on an untitled row',
		source: U,
		steps: [...arrowBack(3), { key: edgeKey('lineStart') }],
		caret: '[0,0]:6'
	},
	{
		name: 'Mod+Home from the title',
		source: T,
		steps: [...arrowBack(2), { key: edgeKey('blockStart') }],
		caret: '[0,0]:7'
	},
	{
		name: 'ArrowUp from the body start',
		source: T,
		steps: [{ at: [[0, 1], 0] }, { key: 'ArrowUp' }, { type: 'x' }],
		caret: '[0,0]:8',
		bytes: ':::tip xTitle\nbody\n:::\n'
	},
	{
		name: 'ArrowUp from inside the body',
		source: T,
		steps: [{ at: [[0, 1], 3] }, { key: 'ArrowUp' }],
		caret: '[0,0]:7'
	},
	{
		name: 'ArrowUp onto an untitled row',
		source: U,
		steps: [{ at: [[0, 1], 3] }, { key: 'ArrowUp' }],
		caret: '[0,0]:6'
	},
	{
		name: 'ArrowDown from the line above',
		source: ABOVE,
		steps: [{ at: [[0], 4] }, { key: 'ArrowDown' }],
		caret: '[1,0]:7'
	},
	{
		name: 'ArrowRight from the end of the line above',
		source: ABOVE,
		steps: [{ at: [[0], 5] }, { key: 'ArrowRight' }],
		caret: '[1,0]:7'
	},
	{
		name: 'ArrowRight from the gap above',
		source: T,
		steps: [...arrowBack(12), { key: 'ArrowLeft' }, { key: 'ArrowRight' }],
		caret: '[0,0]:7'
	},
	{
		name: 'Delete from the gap above',
		source: T,
		steps: [...arrowBack(12), { key: 'ArrowLeft' }, { key: 'Delete' }],
		caret: '[0,0]:7'
	},
	{
		name: 'a click at the row left edge',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { click: 'left' }, { type: 'x' }],
		caret: '[0,0]:8',
		bytes: ':::tip xTitle\nbody\n:::\n'
	},
	{
		name: 'a click at the row left edge with the caret on the row',
		source: T,
		steps: [...arrowBack(0), { click: 'left' }],
		caret: '[0,0]:7'
	},
	{
		name: 'a click at the block far left',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { click: 'far-left' }],
		caret: '[0,0]:7'
	},
	{
		name: 'a press in the row top padding',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { click: 'padding' }],
		caret: '[0,0]:7'
	},
	{
		name: 'a right-click at the row left edge',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { click: 'right-click' }, { key: 'Escape' }],
		caret: '[0,0]:7'
	},
	{
		name: 'a click at an untitled row left edge',
		source: U,
		steps: [{ at: [[0, 1], 2] }, { click: 'left' }],
		caret: '[0,0]:6'
	},
	{
		name: 'ArrowUp from a nested row keeps its column right of the title start',
		source: NEST,
		steps: [
			{ at: [[0, 1, 1], 0] },
			...Array.from({ length: 5 }, () => ({ key: 'ArrowLeft' })),
			{ key: 'ArrowUp' }
		],
		caret: '[0,0]:10'
	}
];

const LEFT_ALONE: Row[] = [
	{
		name: 'ArrowLeft walks from the title start into the colons',
		source: T,
		steps: arrowBack(12),
		caret: '[0,0]:0'
	},
	{
		name: 'End, Shift+Home, a letter keeps the callout',
		source: T,
		steps: [
			...arrowBack(3),
			{ key: edgeKey('lineEnd') },
			{ key: extendKey('lineStart') },
			{ type: 'Q' }
		],
		caret: '[0,0]:8',
		bytes: ':::tip Q\nbody\n:::\n'
	},
	{
		name: 'source mode Home',
		source: T,
		mode: 'source',
		steps: [...arrowBack(2), { key: edgeKey('lineStart') }],
		caret: '[0,0]:0'
	},
	{
		name: 'source mode ArrowUp',
		source: T,
		mode: 'source',
		steps: [{ at: [[0, 1], 3] }, { key: 'ArrowUp' }],
		caret: '[0,0]:0'
	},
	{
		name: 'a switch from source with the caret before the colons',
		source: T,
		mode: 'source',
		steps: [...arrowBack(12), { mode: 'live' }],
		caret: '[0,0]:7'
	},
	{
		name: 'undo puts back the bytes a key at the row start took',
		source: T,
		steps: [...arrowBack(12), { key: 'Delete' }, { key: 'ControlOrMeta+z' }],
		caret: '[0,0]:7',
		bytes: T
	},
	{
		name: 'the host setSelection inside the name',
		source: T,
		steps: [...arrowBack(0), { at: [[0, 0], 4] }],
		caret: '[0,0]:4'
	},
	{
		name: 'a details summary Home',
		source: DETAILS,
		seed: 'details',
		steps: [{ at: [[0, 0], 4] }, { key: edgeKey('lineStart') }],
		caret: '[0,0]:0'
	}
];

async function caretText(page: Page): Promise<string> {
	return page.evaluate(() => {
		const sel = (window as any).__test.getSelection();
		if (!sel) return 'none';
		const p = (q: { path: number[]; offset: number }) => `${JSON.stringify(q.path)}:${q.offset}`;
		return p(sel.anchor) === p(sel.focus) ? p(sel.focus) : `${p(sel.anchor)}..${p(sel.focus)}`;
	});
}

const sourceOf = (page: Page): Promise<string> =>
	page.evaluate(() => (window as any).__test.getSource() as string);

async function run(page: Page, editor: PluginsPage, row: Row): Promise<void> {
	await editor.gotoPlugins(row.seed ?? 'admonitions');
	await editor.loadContent(row.source);
	await editor.setPresentationMode(row.mode ?? 'live');
	for (const step of row.steps) {
		if ('at' in step) await editor.focusBlockAtPath(step.at[0], step.at[1]);
		else if ('key' in step) await page.keyboard.press(step.key);
		else if ('type' in step) await page.keyboard.type(step.type);
		else if ('mode' in step) await editor.setPresentationMode(step.mode);
		else await clickRow(page, step.click, step.row ?? [0, 0]);
		await editor.waitForRenderFlush();
	}
}

async function clickRow(page: Page, where: string, path: number[]): Promise<void> {
	const host = page.locator(`[data-block-path="${JSON.stringify(path)}"]`).first();
	const surface = host.locator('[contenteditable="true"]').first();
	const box = (await surface.boundingBox())!;
	const middle = box.y + box.height / 2;
	if (where === 'far-left') {
		const outer = (await host.boundingBox())!;
		await page.mouse.click(outer.x + 1, middle);
	} else if (where === 'padding') await page.mouse.click(box.x + 2, box.y + 1);
	else if (where === 'right-click') await page.mouse.click(box.x + 1, middle, { button: 'right' });
	else await page.mouse.click(box.x + 1, middle);
}

test.describe('an arrival on a :::tip row in live mode', () => {
	for (const row of ARRIVALS) {
		test(row.name, async ({ page }) => {
			const editor = new PluginsPage(page);
			await run(page, editor, row);
			await expect.poll(() => caretText(page)).toBe(row.caret);
			if (row.bytes) expect(await sourceOf(page)).toBe(row.bytes);
		});
	}
});

test.describe('the opener row gestures left as they were', () => {
	for (const row of LEFT_ALONE) {
		test(row.name, async ({ page }) => {
			const editor = new PluginsPage(page);
			await run(page, editor, row);
			await expect.poll(() => caretText(page)).toBe(row.caret);
			if (row.bytes) expect(await sourceOf(page)).toBe(row.bytes);
		});
	}
});

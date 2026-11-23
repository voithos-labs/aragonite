import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { edgeKey, extendKey, WORD_MODIFIER } from '../../platform-keys';
import { multiClick } from '../../multi-click';
import { skipUnlessSupported } from '../../browser-engine';
import { textRunCenter, textRunStart } from '../../text-runs';
import { attachIme } from '../../simulation/ime';

/**
 * Where a caret arriving on a `:::` container's opener row rests in live mode: at the title's
 * start (the row's end when untitled), for the arrivals that read `browser/offsets.ts ::
 * arrivalRawStart` (a landing from another line, Home, a click, a page step, a host's
 * `navigateTo`). One row per route, then the routes left as they were: a step, source mode, a
 * restore, a `<details>` summary. Then an arrow over a selection on the row, which ArrowLeft
 * collapses by how its start got there: by steps, or by an arrival. Then the carets the browser leaves
 * (Tab, a script's `focus()`, a line step), which the caret writer moves unless they are steps.
 * Then the presses: a titled row shows its `:::name` when the press ends, so a click, a
 * double-click and a drag read the text where the user saw it. The requirement file lists the
 * arrivals the rule does not reach.
 */

const T = ':::tip Title\nbody\n:::\n';
const U = ':::tip\nbody\n:::\n';
const ABOVE = 'above\n\n:::tip Title\nbody\n:::\n';
const NEST = '::::note Outer\n:::tip Inner\nin\n:::\n::::\n';
const DETAILS = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

const TWO = ':::tip Title\nbody\n:::\n\nafter\n';
const LONG =
	T + Array.from({ length: 60 }, (_, i) => `\nparagraph ${i} of the long page\n`).join('');

type Step =
	| { at: [number[], number] }
	| { key: string; times?: number }
	| { type: string }
	| { click: 'left' | 'shift-left' | 'far-left' | 'padding' | 'right-click'; row?: number[] }
	| { tripleClick: string }
	| { navigateTo: [number[]] | [number[], number] }
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
		name: 'a press in an untitled row top padding',
		source: U,
		steps: [{ at: [[0, 1], 2] }, { click: 'padding' }],
		caret: '[0,0]:6'
	},
	{
		name: 'a right-click at an untitled row left edge',
		source: U,
		steps: [{ at: [[0, 1], 2] }, { click: 'right-click' }, { key: 'Escape' }],
		caret: '[0,0]:6'
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
	},
	{
		name: 'Mod+A twice, then ArrowLeft',
		source: TWO,
		steps: [...arrowBack(2), { key: 'ControlOrMeta+a', times: 2 }, { key: 'ArrowLeft' }],
		caret: '[0,0]:7'
	},
	{
		name: 'PageUp twice from the body',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { key: 'PageUp', times: 2 }, { type: 'x' }],
		caret: '[0,0]:8',
		bytes: ':::tip xTitle\nbody\n:::\n'
	},
	{
		name: 'PageUp held up a long page',
		source: LONG,
		steps: [{ at: [[40], 3] }, { key: 'PageUp', times: 14 }],
		caret: '[0,0]:7'
	},
	{
		name: "the host's navigateTo on the row with no offset",
		source: T,
		steps: [{ at: [[0, 1], 2] }, { navigateTo: [[0, 0]] }, { type: 'x' }],
		caret: '[0,0]:8',
		bytes: ':::tip xTitle\nbody\n:::\n'
	},
	{
		name: "the host's navigateTo on the callout with no offset",
		source: T,
		steps: [{ at: [[0, 1], 2] }, { navigateTo: [[0]] }],
		caret: '[0,0]:7'
	}
];

const LEFT_ALONE: Row[] = [
	{
		name: 'source mode Shift+Home, then ArrowLeft',
		source: T,
		mode: 'source',
		steps: [...arrowBack(2), { key: extendKey('lineStart') }, { key: 'ArrowLeft' }],
		caret: '[0,0]:0'
	},
	{
		name: "the host's navigateTo on the row at offset 0",
		source: T,
		steps: [{ at: [[0, 1], 2] }, { navigateTo: [[0, 0], 0] }],
		caret: '[0,0]:0'
	},
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
		name: 'source mode click at the row left edge',
		source: T,
		mode: 'source',
		steps: [{ at: [[0, 1], 2] }, { click: 'left' }],
		caret: '[0,0]:0'
	},
	{
		name: 'source mode ArrowRight from the end of the line above',
		source: ABOVE,
		mode: 'source',
		steps: [{ at: [[0], 5] }, { key: 'ArrowRight' }],
		caret: '[1,0]:0'
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
		else if ('key' in step) {
			for (let i = 0; i < (step.times ?? 1); i++) await page.keyboard.press(step.key);
		} else if ('type' in step) await page.keyboard.type(step.type);
		else if ('mode' in step) await editor.setPresentationMode(step.mode);
		else if ('tripleClick' in step) {
			await multiClick(page, await textRunCenter(page, step.tripleClick, { path: [0, 0] }), 3);
		} else if ('navigateTo' in step) {
			await page.evaluate(
				(args) => (window as any).__test.rects.navigateTo(...args),
				step.navigateTo
			);
		} else await clickRow(page, step.click, step.row ?? [0, 0]);
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
	else if (where === 'shift-left') {
		await page.keyboard.down('Shift');
		await page.mouse.click(box.x + 1, middle);
		await page.keyboard.up('Shift');
	} else await page.mouse.click(box.x + 1, middle);
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

// ── An arrow over a selection on the row ─────────────────────────────────────

/** A selection made on the row: ArrowLeft rests at `left`, and `x` then makes the row read `row`;
 *  ArrowRight rests at `right`, its end. */
interface Collapse {
	name: string;
	source: string;
	steps: Step[];
	left: number;
	row: string;
	right: number;
}

const ARRIVE: Step[] = [{ at: [[0, 1], 0] }, { key: 'ArrowUp' }];
const shift = (key: string, times = 1): Step => ({ key: `Shift+${key}`, times });
const HOME: Step = { key: extendKey('lineStart') };
const ALL: Step = { key: 'ControlOrMeta+a' };
const SHIFT_LEFT: Step = { click: 'shift-left' };

const COLLAPSES: Collapse[] = [
	{
		name: 'Shift+ArrowLeft twice from the title start',
		source: T,
		steps: [...ARRIVE, shift('ArrowLeft', 2)],
		left: 5,
		row: ':::tixp Title',
		right: 7
	},
	{
		name: 'Shift+ArrowLeft five times from inside the title',
		source: T,
		steps: [...arrowBack(2), shift('ArrowLeft', 5)],
		left: 5,
		row: ':::tixp Title',
		right: 10
	},
	{
		name: 'Shift+ArrowRight four times from inside the name',
		source: T,
		steps: [...arrowBack(7), shift('ArrowRight', 4)],
		left: 5,
		row: ':::tixp Title',
		right: 9
	},
	{
		name: 'Shift+ArrowLeft twice from inside the name',
		source: T,
		steps: [...arrowBack(7), shift('ArrowLeft', 2)],
		left: 3,
		row: ':::xtip Title',
		right: 5
	},
	{
		name: 'Shift+Home from inside the title',
		source: T,
		steps: [...arrowBack(2), HOME],
		left: 7,
		row: ':::tip xTitle',
		right: 10
	},
	{
		name: 'Shift+Home from the title start',
		source: T,
		steps: [...ARRIVE, HOME],
		left: 7,
		row: ':::tip xTitle',
		right: 7
	},
	{
		name: 'Shift+Home from inside the name',
		source: T,
		steps: [...arrowBack(7), HOME],
		left: 7,
		row: ':::tip xTitle',
		right: 5
	},
	{
		name: 'Mod+A from the title start',
		source: T,
		steps: [...ARRIVE, ALL],
		left: 7,
		row: ':::tip xTitle',
		right: 12
	},
	{
		name: 'Mod+A from inside the name',
		source: T,
		steps: [...arrowBack(7), ALL],
		left: 7,
		row: ':::tip xTitle',
		right: 12
	},
	{
		name: 'Mod+A, then Shift+ArrowLeft',
		source: T,
		steps: [...ARRIVE, ALL, shift('ArrowLeft')],
		left: 7,
		row: ':::tip xTitle',
		right: 11
	},
	{
		name: 'a triple-click on the title from the body',
		source: T,
		steps: [{ at: [[0, 1], 2] }, { tripleClick: 'Title' }],
		left: 7,
		row: ':::tip xTitle',
		right: 12
	},
	{
		name: 'a Shift+click at the row left edge from inside the title',
		source: T,
		steps: [...arrowBack(2), SHIFT_LEFT],
		left: 7,
		row: ':::tip xTitle',
		right: 10
	},
	{
		name: 'a Shift+click at the row left edge from the title start',
		source: T,
		steps: [...ARRIVE, SHIFT_LEFT],
		left: 7,
		row: ':::tip xTitle',
		right: 7
	},
	{
		name: 'a Shift+click at the row left edge from inside the name',
		source: T,
		steps: [...arrowBack(7), SHIFT_LEFT],
		left: 7,
		row: ':::tip xTitle',
		right: 5
	},
	{
		name: 'untitled, Shift+Home from the row end',
		source: U,
		steps: [...ARRIVE, HOME],
		left: 6,
		row: ':::tip x',
		right: 6
	},
	{
		name: 'untitled, Shift+Home from inside the name',
		source: U,
		steps: [...arrowBack(2), HOME],
		left: 6,
		row: ':::tip x',
		right: 4
	},
	{
		name: 'untitled, Mod+A',
		source: U,
		steps: [...ARRIVE, ALL],
		left: 6,
		row: ':::tip x',
		right: 6
	},
	{
		name: 'untitled, a triple-click on the name',
		source: U,
		steps: [...ARRIVE, { tripleClick: 'tip' }],
		left: 6,
		row: ':::tip x',
		right: 6
	},
	{
		name: 'untitled, a Shift+click at the row left edge',
		source: U,
		steps: [...ARRIVE, SHIFT_LEFT],
		left: 6,
		row: ':::tip x',
		right: 6
	},
	{
		name: 'untitled, Shift+ArrowLeft twice from the row end',
		source: U,
		steps: [...ARRIVE, shift('ArrowLeft', 2)],
		left: 4,
		row: ':::txip',
		right: 6
	},
	{
		name: 'untitled, Shift+ArrowRight twice from inside the name',
		source: U,
		steps: [...arrowBack(2), shift('ArrowRight', 2)],
		left: 4,
		row: ':::txip',
		right: 6
	}
];

/** A word step over a selection starts from where ArrowLeft would rest, so after an arrival it
 *  steps from the title's start (the row's end when untitled) into the name, as from a caret. */
const WORD_LEFT: Omit<Collapse, 'right'>[] = [
	{ name: 'Mod+A', source: T, steps: [...ARRIVE, ALL], left: 3, row: ':::xtip Title' },
	{
		name: 'Shift+Home from the title start',
		source: T,
		steps: [...ARRIVE, HOME],
		left: 3,
		row: ':::xtip Title'
	},
	{ name: 'untitled, Mod+A', source: U, steps: [...ARRIVE, ALL], left: 3, row: ':::xtip' }
];

test.describe('a word step over a selection on a :::tip row in live mode', () => {
	for (const row of WORD_LEFT) {
		test(`${row.name}, then a word step left and x`, async ({ page }) => {
			const editor = new PluginsPage(page);
			const steps = [...row.steps, { key: `${WORD_MODIFIER}+ArrowLeft` }];
			await run(page, editor, { name: row.name, source: row.source, steps, caret: '' });
			await expect.poll(() => caretText(page)).toBe(`[0,0]:${row.left}`);
			expect(await typeX(page, editor)).toBe(`${row.row}\nbody\n:::\n`);
		});
	}
});

test.describe('an arrow over a selection on a :::tip row in live mode', () => {
	for (const row of COLLAPSES) {
		const select: Row = { name: row.name, source: row.source, steps: row.steps, caret: '' };
		test(`${row.name}, then ArrowLeft and x`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await run(page, editor, { ...select, steps: [...row.steps, { key: 'ArrowLeft' }] });
			await expect.poll(() => caretText(page)).toBe(`[0,0]:${row.left}`);
			expect(await typeX(page, editor)).toBe(`${row.row}\nbody\n:::\n`);
		});

		test(`${row.name}, then ArrowRight`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await run(page, editor, { ...select, steps: [...row.steps, { key: 'ArrowRight' }] });
			await expect.poll(() => caretText(page)).toBe(`[0,0]:${row.right}`);
		});
	}
});

// ── A caret the browser leaves on the row ────────────────────────────────────

const WRAPPED = `:::tip ${'Title words that run on '.repeat(12).trim()}\nbody\n:::\n`;

async function loadLive(page: Page, source: string): Promise<PluginsPage> {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('admonitions');
	await editor.loadContent(source);
	await editor.setPresentationMode('live');
	return editor;
}

/** Presses `key` until focus is in the block at `path`, as a user tabbing through the page does. */
async function tabUntil(page: Page, key: string, path: string): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await page.keyboard.press(key);
		const at = await page.evaluate(() =>
			document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path')
		);
		if (at === path) return;
	}
	throw new Error(`${key} never reached ${path}`);
}

test.describe('a caret the browser leaves on a :::tip row in live mode', () => {
	test('Tab into the editor lands at the title start', async ({ page }) => {
		const editor = await loadLive(page, T);
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await tabUntil(page, 'Tab', '[0,0]');
		await expect.poll(() => caretText(page)).toBe('[0,0]:7');
		expect(await typeX(page, editor)).toBe(':::tip xTitle\nbody\n:::\n');
	});

	test('Shift+Tab from the body lands at the title start', async ({ page }) => {
		const editor = await loadLive(page, T);
		await editor.focusBlockAtPath([0, 1], 2);
		await tabUntil(page, 'Shift+Tab', '[0,0]');
		await expect.poll(() => caretText(page)).toBe('[0,0]:7');
		expect(await typeX(page, editor)).toBe(':::tip xTitle\nbody\n:::\n');
	});

	test("the row's own focus() lands at the title start", async ({ page }) => {
		const editor = await loadLive(page, T);
		await page.evaluate(() =>
			document
				.querySelector<HTMLElement>('[data-block-path="[0,0]"] [contenteditable="true"]')!
				.focus()
		);
		await expect.poll(() => caretText(page)).toBe('[0,0]:7');
		expect(await typeX(page, editor)).toBe(':::tip xTitle\nbody\n:::\n');
	});

	test('ArrowUp inside a wrapped title onto its first line lands at the title start', async ({
		page
	}) => {
		const editor = await loadLive(page, WRAPPED);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press('ArrowUp');
		const lines = await page.evaluate(() => {
			const el = document.querySelector<HTMLElement>(
				'[data-block-path="[0,0]"] [contenteditable="true"]'
			)!;
			return Math.round(
				el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)
			);
		});
		expect(lines).toBeGreaterThan(1);
		for (let i = 1; i < lines; i++) await page.keyboard.press('ArrowUp');
		await expect.poll(() => caretText(page)).toBe('[0,0]:7');
	});

	for (const [what, before] of [
		['a step into the name', []],
		['a letter typed in the name', [{ type: 'x' }]]
	] as const) {
		test(`focus that leaves after ${what} and comes back by script lands at the title start`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await run(page, editor, {
				name: '',
				source: T,
				steps: [...arrowBack(8), ...before],
				caret: ''
			});
			await page.evaluate(() => {
				const field = document.body.appendChild(document.createElement('input'));
				field.focus();
			});
			await page.keyboard.type('q');
			await page.evaluate(() =>
				document
					.querySelector<HTMLElement>('[data-block-path="[0,0]"] [contenteditable="true"]')!
					.focus()
			);
			await expect.poll(() => caretText(page)).toBe(before.length ? '[0,0]:8' : '[0,0]:7');
		});
	}

	test('a letter typed inside the name stays there', async ({ page }) => {
		const editor = new PluginsPage(page);
		await run(page, editor, { name: '', source: T, steps: arrowBack(8), caret: '' });
		expect(await typeX(page, editor)).toBe(':::txip Title\nbody\n:::\n');
		await expect.poll(() => caretText(page)).toBe('[0,0]:5');
	});

	// Each first key renames `tip` to a name the grammar does not hold, which draws the row again.
	for (const { keys, after } of [
		{ keys: ['Backspace', 'Backspace'], after: [':::ip Title', '::ip Title'] },
		{ keys: ['Delete', 'Delete'], after: [':::tp Title', ':::t Title'] },
		{ keys: ['Shift+ArrowLeft', 'Delete', 'Backspace'], after: ['', ':::ip Title', '::ip Title'] }
	]) {
		test(`${keys.join(', ')} inside the name edit the name`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await run(page, editor, { name: '', source: T, steps: arrowBack(8), caret: '' });
			for (const [i, key] of keys.entries()) {
				await page.keyboard.press(key);
				if (after[i]) await expect.poll(() => sourceOf(page)).toBe(`${after[i]}\nbody\n:::\n`);
			}
		});
	}

	test('a composition inside the name stays there', async ({ page }) => {
		const editor = new PluginsPage(page);
		await run(page, editor, { name: '', source: T, steps: arrowBack(8), caret: '' });
		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('か');
		await expect.poll(() => sourceOf(page)).toBe(':::tかip Title\nbody\n:::\n');
		await expect.poll(() => caretText(page)).toBe('[0,0]:5');
	});
});

// ── A press on a row not showing its `:::name` ───────────────────────────────

const WORDS = ':::tip Title words\nbody\n:::\n';
const NEST_WORDS = '::::note Outer\n:::tip Inner words\nin\n:::\n::::\n';
const ROW = [0, 0];
/** A point just inside the left edge of `needle` in the row at `path`: a click there rests before
 *  its first letter. */
const before = (page: Page, needle: string, path: number[] = ROW) =>
	textRunStart(page, needle, { path });

/** The computed `display` of the row's `:::name` marker. */
const markerDisplay = (page: Page, path: number[] = ROW): Promise<string> =>
	page.evaluate((path) => {
		const marker = document.querySelector(
			`[data-block-path="${JSON.stringify(path)}"] [contenteditable="true"] .md-marker`
		)!;
		return getComputedStyle(marker).display;
	}, path);

async function loadWithCaretInBody(
	page: Page,
	source: string,
	body: number[],
	mode: 'live' | 'preview-block' = 'live'
): Promise<PluginsPage> {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('admonitions');
	await editor.loadContent(source);
	await editor.setPresentationMode(mode);
	await editor.focusBlockAtPath(body, 2);
	await editor.waitForRenderFlush();
	return editor;
}

async function typeX(page: Page, editor: PluginsPage): Promise<string> {
	await page.keyboard.type('x');
	await editor.waitForRenderFlush();
	return sourceOf(page);
}

test.describe('a press on a :::tip row not showing its name', () => {
	test('a click on a title letter lands on that letter', async ({ page }) => {
		const editor = await loadWithCaretInBody(page, WORDS, [0, 1]);
		const at = await before(page, 'ords');
		await page.mouse.click(at.x, at.y);
		await expect.poll(() => caretText(page)).toBe('[0,0]:14');
		expect(await typeX(page, editor)).toBe(':::tip Title wxords\nbody\n:::\n');
	});

	test('a click on a nested row lands on the letter', async ({ page }) => {
		const editor = await loadWithCaretInBody(page, NEST_WORDS, [0, 1, 1]);
		const at = await before(page, 'ords', [0, 1, 0]);
		await page.mouse.click(at.x, at.y);
		await expect.poll(() => caretText(page)).toBe('[0,1,0]:14');
		expect(await typeX(page, editor)).toBe('::::note Outer\n:::tip Inner wxords\nin\n:::\n::::\n');
	});

	test('a double-click selects the title word under it', async ({ page }) => {
		const editor = await loadWithCaretInBody(page, WORDS, [0, 1]);
		const at = await textRunCenter(page, 'words', { path: ROW });
		await multiClick(page, at, 2);
		await expect.poll(() => caretText(page)).toBe('[0,0]:13..[0,0]:18');
		expect(await typeX(page, editor)).toBe(':::tip Title x\nbody\n:::\n');
	});

	test('a double-click in preview-block selects the title word under it', async ({ page }) => {
		await loadWithCaretInBody(page, WORDS, [0, 1], 'preview-block');
		const at = await textRunCenter(page, 'words', { path: ROW });
		await multiClick(page, at, 2);
		await expect.poll(() => caretText(page)).toBe('[0,0]:13..[0,0]:18');
	});

	test('a drag across title letters selects those letters', async ({ page }) => {
		const editor = await loadWithCaretInBody(page, WORDS, [0, 1]);
		const from = await before(page, 'itle');
		const to = await before(page, 'ds');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 6 });
		await page.mouse.up();
		await expect.poll(() => caretText(page)).toBe('[0,0]:8..[0,0]:16');
		expect(await typeX(page, editor)).toBe(':::tip Txds\nbody\n:::\n');
	});

	test('a drag leftward past the row stays in the title', async ({ page }) => {
		await loadWithCaretInBody(page, WORDS, [0, 1]);
		const from = await before(page, 'ords');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(2, from.y, { steps: 6 });
		await page.mouse.up();
		await expect.poll(() => caretText(page)).toBe('[0,0]:14..[0,0]:7');
	});

	test('the name shows when the button comes up, not when it goes down', async ({ page }) => {
		await loadWithCaretInBody(page, WORDS, [0, 1]);
		const at = await before(page, 'ords');
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		await expect.poll(() => caretText(page)).toBe('[0,0]:14');
		expect(await markerDisplay(page)).toBe('none');
		await page.mouse.up();
		await expect.poll(() => markerDisplay(page)).toBe('inline');
	});

	test('a keyboard arrival shows the name at once', async ({ page }) => {
		await loadWithCaretInBody(page, WORDS, [0, 1]);
		expect(await markerDisplay(page)).toBe('none');
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => markerDisplay(page)).toBe('inline');
	});

	test('a press on an untitled row shows its name at once, until a first letter', async ({
		page
	}) => {
		await loadWithCaretInBody(page, U, [0, 1]);
		const box = (await page
			.locator('[data-block-path="[0,0]"] [contenteditable="true"]')
			.boundingBox())!;
		await page.mouse.move(box.x + 60, box.y + box.height / 2);
		await page.mouse.down();
		await expect.poll(() => markerDisplay(page)).toBe('inline');
		// The click's own landing waits for the release, so End takes the caret to the name's end.
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type(' T');
		await expect.poll(() => sourceOf(page)).toBe(':::tip T\nbody\n:::\n');
		// A titled row waits for the release, this one included.
		await expect.poll(() => markerDisplay(page)).toBe('none');
		await page.mouse.up();
		await expect.poll(() => markerDisplay(page)).toBe('inline');
	});

	test('a titled generic row shows its name or its drawn copy, never both', async ({ page }) => {
		const shown = () =>
			page.evaluate(() => {
				const row = document.querySelector<HTMLElement>('[data-source-at-caret]')!;
				const copy = getComputedStyle(row, '::before').content;
				const name = getComputedStyle(row.querySelector('.md-marker')!).display;
				return `${name === 'inline' ? 'name' : ''}${copy.startsWith('"') ? 'copy' : ''}`;
			});
		await loadWithCaretInBody(page, ':::foo Title\nbody\n:::\n', [0, 1]);
		const at = await before(page, 'itle');
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		await expect.poll(() => caretText(page)).toBe('[0,0]:8');
		expect(await shown()).toBe('copy');
		await page.mouse.up();
		await expect.poll(shown).toBe('name');
		const body = (await page
			.locator('[data-block-path="[0,1]"] [contenteditable="true"]')
			.boundingBox())!;
		await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
		await page.mouse.down();
		await expect.poll(() => caretText(page)).toMatch(/^\[0,1\]:/);
		expect(await shown()).toBe('name');
		await page.mouse.up();
		await expect.poll(shown).toBe('copy');
	});

	for (const source of [U, ':::foo\nbody\n:::\n']) {
		test(`a press that leaves an untitled row hides its name at once (${source.split('\n')[0]})`, async ({
			page
		}) => {
			await loadWithCaretInBody(page, source, [0, 1]);
			await page.keyboard.press('ArrowUp');
			await expect.poll(() => markerDisplay(page)).toBe('inline');
			const body = (await page
				.locator('[data-block-path="[0,1]"] [contenteditable="true"]')
				.boundingBox())!;
			await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
			await page.mouse.down();
			await expect.poll(() => caretText(page)).toMatch(/^\[0,1\]:/);
			expect(await markerDisplay(page)).toBe('none');
			await page.mouse.up();
			expect(await markerDisplay(page)).toBe('none');
		});
	}

	test('a held press on a titled row shows its name once the title is gone', async ({ page }) => {
		await loadWithCaretInBody(page, ':::tip T\nbody\n:::\n', [0, 1]);
		const at = await before(page, 'T');
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		await expect.poll(() => caretText(page)).toBe('[0,0]:7');
		expect(await markerDisplay(page)).toBe('none');
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await expect.poll(() => sourceOf(page)).toBe(U);
		await expect.poll(() => markerDisplay(page)).toBe('inline');
		await page.mouse.up();
		expect(await markerDisplay(page)).toBe('inline');
	});

	test('the name stays shown as the title gains its first letter and loses its last', async ({
		page
	}) => {
		const editor = await loadWithCaretInBody(page, U, [0, 1]);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => markerDisplay(page)).toBe('inline');
		await page.keyboard.type(' T');
		await editor.waitForRenderFlush();
		expect(await sourceOf(page)).toBe(':::tip T\nbody\n:::\n');
		expect(await markerDisplay(page)).toBe('inline');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();
		expect(await sourceOf(page)).toBe(U);
		expect(await markerDisplay(page)).toBe('inline');
	});
});

test.describe('a tap on a :::tip row not showing its name', () => {
	test.use({ hasTouch: true });

	// At the word's start, where WebKit puts a tap anywhere in the word.
	test('a tap on a title word lands on that word', async ({ page }) => {
		skipUnlessSupported(page, 'touch');
		const editor = await loadWithCaretInBody(page, WORDS, [0, 1]);
		const at = await before(page, 'words');
		await page.touchscreen.tap(at.x, at.y);
		await expect.poll(() => caretText(page)).toBe('[0,0]:13');
		expect(await typeX(page, editor)).toBe(':::tip Title xwords\nbody\n:::\n');
	});

	test('a double tap selects the title word under it', async ({ page, browserName }) => {
		skipUnlessSupported(page, 'touch');
		test.skip(browserName === 'webkit', 'desktop WebKit sends two taps as two single clicks');
		await loadWithCaretInBody(page, WORDS, [0, 1]);
		const at = await textRunCenter(page, 'words', { path: ROW });
		await page.touchscreen.tap(at.x, at.y);
		await page.touchscreen.tap(at.x, at.y);
		await expect.poll(() => caretText(page)).toBe('[0,0]:13..[0,0]:18');
	});
});

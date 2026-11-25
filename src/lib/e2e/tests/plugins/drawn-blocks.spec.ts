import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath } from './helpers';
import { edgeKey, extendKey } from '../../platform-keys';
import { clickInPlace, hoverInPlace } from '../../click-in-place';
import { engineSupports } from '../../browser-engine';

/**
 * Blocks a plugin draws with `draw` (requirements/plugins/drawn-blocks.md), from
 * `routes/test/plugins/drawn`: a box with an editing surface of its own, a fence drawn as a
 * preview, a container drawn as a box, a text block with chrome, and a box drawn whole.
 */

const ABOVE = 0;
const FIELD = 1;
const BELOW = 2;
const SHOWN = 3;
// The field's first line, `first line here`, and the break after it.
const SECOND_LINE_START = 16;

interface FieldCaret {
	offset: number;
	x: number;
}

const fieldCaret = (page: Page): Promise<FieldCaret | null> =>
	page.evaluate(() => (window as any).__drawnField?.() ?? null);

// The native caret's x, which is where the text block's own caret sits.
const caretX = async (page: Page): Promise<number> => {
	const left = await page.evaluate(() => {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return null;
		const rects = selection.getRangeAt(0).getClientRects();
		return rects.length ? rects[0].left : null;
	});
	expect(left).not.toBeNull();
	return left!;
};

const caretPath = (page: Page): Promise<number[] | null> =>
	page.evaluate(() => (window as any).__test.getSelection()?.focus.path ?? null);

const caretOffset = (page: Page): Promise<number | null> =>
	page.evaluate(() => (window as any).__test.getSelection()?.focus.offset ?? null);

async function placeCaret(page: Page, path: number[], position: 'start' | 'end' | number) {
	const placed = await page.evaluate(
		({ path, position }) => (window as any).__test.placeCaret(path, position) as Promise<boolean>,
		{ path, position }
	);
	expect(placed).toBe(true);
}

// One field character is 16px monospace wide, about 9.6px; a column rounds to the nearest one.
const SAME_COLUMN = 6;

test.describe('a drawn box with its own editing surface', () => {
	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
	});

	test('ArrowDown from the line above enters the first line at the column', async ({ page }) => {
		await placeCaret(page, [ABOVE], 10);
		const from = await caretX(page);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		const at = (await fieldCaret(page))!;
		expect(at.offset).toBeLessThan(SECOND_LINE_START);
		expect(Math.abs(at.x - from)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowUp from the line below enters the last line at the column', async ({ page }) => {
		await placeCaret(page, [BELOW], 10);
		const from = await caretX(page);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		const at = (await fieldCaret(page))!;
		expect(at.offset).toBeGreaterThanOrEqual(SECOND_LINE_START);
		expect(Math.abs(at.x - from)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowUp on the first line leaves into the line above at the column', async ({ page }) => {
		await placeCaret(page, [ABOVE], 4);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		const inField = (await fieldCaret(page))!;
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => caretPath(page)).toEqual([ABOVE]);
		expect(Math.abs((await caretX(page)) - inField.x)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowDown on the last line leaves into the line below at the column', async ({ page }) => {
		await placeCaret(page, [BELOW], 4);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		const inField = (await fieldCaret(page))!;
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => caretPath(page)).toEqual([BELOW]);
		expect(Math.abs((await caretX(page)) - inField.x)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowRight and ArrowLeft cross the start edge both ways', async ({ page }) => {
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 0 });
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => caretPath(page)).toEqual([ABOVE]);
		expect(await caretOffset(page)).toBe('above the field, a line'.length);
	});

	test('ArrowLeft and ArrowRight cross the end edge both ways', async ({ page }) => {
		await placeCaret(page, [BELOW], 'start');
		await page.keyboard.press('ArrowLeft');
		const end = 'first line here\nsecond line here'.length;
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: end });
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => caretPath(page)).toEqual([BELOW]);
		expect(await caretOffset(page)).toBe(0);
	});

	test('undo puts the caret back at the offset the field gave', async ({ page }) => {
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 7 });
		await page.keyboard.press('Alt+ArrowDown');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource() as string))
			.toMatch(/below the field, a line\n\n```field\n/);
		await page.keyboard.press('ControlOrMeta+z');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource() as string))
			.toMatch(/^above the field, a line\n\n```field\n/);
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 7 });
		expect(await caretPath(page)).toEqual([FIELD]);
	});
});

test.describe('a drawn box writing its own bytes', () => {
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);

	test('leaving the field writes its text into the fence, after an edit above moved it', async ({
		page
	}) => {
		await new PluginsPage(page).gotoPlugins('drawn');
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.type('!');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type(' more');
		await page.keyboard.press('ArrowUp');
		await expect
			.poll(() => source(page))
			.toContain('a line!\n\n```field\nfirst line here more\nsecond line here\n```\n');

		await page.keyboard.press('ControlOrMeta+z');
		await expect
			.poll(() => source(page))
			.toContain('```field\nfirst line here\nsecond line here\n```');
	});
});

test.describe("the field's unwritten text", () => {
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);
	const run = (page: Page, id: string) =>
		page.evaluate((id) => (window as any).__test.runCommand(id) as boolean, id);
	const undoDepth = (page: Page) =>
		page.evaluate(() => (window as any).__test.undoDepth() as number);
	const field = (page: Page) => page.locator('.drawn-field textarea');
	const WRITTEN = 'a line!\n\n```field\nfirst line here\nsecond line here\n```';
	const TYPED = 'a line!\n\n```field\nfirst line here typed\nsecond line here\n```';
	let editor: PluginsPage;

	// A `!` typed at the end of the line above, then ` typed` at the end of the field's first line.
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.type('!');
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 0 });
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type(' typed');
		await expect(field(page)).toHaveValue('first line here typed\nsecond line here');
	});

	test('an undo the editor runs saves it as the step it takes back, so a redo writes it', async ({
		page
	}) => {
		expect(await run(page, 'history.undo')).toBe(true);
		await expect.poll(() => source(page)).toContain(WRITTEN);
		await expect(field(page)).toHaveValue('first line here\nsecond line here');
		await placeCaret(page, [BELOW], 'end');
		expect(await source(page)).toContain(WRITTEN);
		await run(page, 'history.redo');
		await expect.poll(() => source(page)).toContain(TYPED);
	});

	test('a click below writes it as it leaves, and Ctrl+Z there takes it back out', async ({
		page
	}) => {
		await clickInPlace(page.locator(`[data-block-path='[${BELOW}]']`));
		await expect.poll(() => source(page)).toContain(TYPED);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => source(page)).toContain(WRITTEN);
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(() => source(page)).toContain(TYPED);
	});

	test("Ctrl+Z in the field is the field's own, and the editor's undo stack stands", async ({
		page
	}) => {
		await page.keyboard.press('ControlOrMeta+z');
		await expect(field(page)).not.toHaveValue('first line here typed\nsecond line here');
		expect(await source(page)).toContain(WRITTEN);
		expect(await undoDepth(page)).toBe(1);
	});

	test('a switch to live mode writes it as one step, which the next undo takes back', async ({
		page
	}) => {
		await editor.setPresentationMode('live');
		await expect.poll(() => source(page)).toContain(TYPED);
		expect(await undoDepth(page)).toBe(2);
		await run(page, 'history.undo');
		await expect.poll(() => source(page)).toContain(WRITTEN);
	});

	test('a switch to reading mode writes it as one step, kept on the way back', async ({ page }) => {
		await editor.setPresentationMode('reading');
		await expect.poll(() => source(page)).toContain(TYPED);
		expect(await undoDepth(page)).toBe(2);
		await editor.setPresentationMode('source');
		expect(await source(page)).toContain(TYPED);
		await run(page, 'history.undo');
		await expect.poll(() => source(page)).toContain(WRITTEN);
	});

	// A host's toolbar button running the editor's undo: one that keeps focus off itself, as a
	// toolbar does, and a plain one, whose press blurs the field first.
	for (const keepsFocus of [true, false]) {
		test(`an undo from a host button that ${keepsFocus ? 'keeps' : 'takes'} focus saves it into redo`, async ({
			page
		}) => {
			await page.evaluate((keeps) => {
				const button = document.createElement('button');
				button.textContent = 'Undo';
				button.dataset.testid = 'host-undo';
				button.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 9999;';
				if (keeps) button.addEventListener('mousedown', (e) => e.preventDefault());
				button.addEventListener('click', () => (window as any).__test.runCommand('history.undo'));
				document.body.append(button);
			}, keepsFocus);
			await page.getByTestId('host-undo').click();
			await expect.poll(() => source(page)).toContain(WRITTEN);
			await expect(field(page)).toHaveValue('first line here\nsecond line here');
			expect(await undoDepth(page)).toBe(1);
			await run(page, 'history.redo');
			await expect.poll(() => source(page)).toContain(TYPED);
		});
	}

	test('a new document drops it', async ({ page }) => {
		await editor.loadContent('Other\n');
		await expect.poll(() => source(page)).toBe('Other\n');
		expect(await undoDepth(page)).toBe(0);
	});
});

test.describe('an open field scrolled out of the window', () => {
	test('writes its text as it leaves where blur fires, one undo step, as 0.11.5 does', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
		const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor`);
		await editor.loadContent(['```field\none\n```', ...filler].join('\n\n') + '\n');
		await placeCaret(page, [1], 'start');
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		await page.keyboard.type('kept ');
		await editor.scrollEditorTo(1_000_000);
		await expect(page.locator('.drawn-field')).toHaveCount(0);
		const source = () => page.evaluate(() => (window as any).__test.getSource() as string);
		const depth = () => page.evaluate(() => (window as any).__test.undoDepth() as number);
		if (engineSupports(page, 'blurOnRemoval')) {
			await expect.poll(source).toMatch(/^```field\nkept one\n```\n/);
			expect(await depth()).toBe(1);
		} else {
			// No blur reaches the removed field, so its text goes with it, as on 0.11.5.
			await editor.waitForRenderFlush();
			expect(await source()).toMatch(/^```field\none\n```\n/);
			expect(await depth()).toBe(0);
		}
	});
});

test.describe("the field's menu row", () => {
	const run = (page: Page, id: string) =>
		page.evaluate((id) => (window as any).__test.view.run(id) as boolean, id);
	const hold = (page: Page, index: number) =>
		page.evaluate((index) => (window as any).__test.view.hold(index), index);
	const fieldFocused = (page: Page) =>
		page.evaluate(() => document.activeElement?.closest('.drawn-field') != null);

	test('focuses the field through its handle while drawn', async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
		await hold(page, FIELD);
		expect(await run(page, 'drawn/focus-field')).toBe(true);
		await expect.poll(() => fieldFocused(page)).toBe(true);
	});

	test('declines once the field is scrolled out of the window', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
		const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor`);
		await editor.loadContent(['```field\none\n```', ...filler].join('\n\n') + '\n');
		await hold(page, 0);
		await editor.scrollEditorTo(1_000_000);
		await expect(page.locator('.drawn-field')).toHaveCount(0);
		expect(await run(page, 'drawn/focus-field')).toBe(false);
		expect(await fieldFocused(page)).toBe(false);
	});

	test("declines on another drawn type's block, which doesn't place it", async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
		await hold(page, SHOWN);
		expect(await run(page, 'drawn/focus-field')).toBe(false);
		expect(await fieldFocused(page)).toBe(false);
	});
});

// Two boxes back to back: no gap caret opens between them, so whole focus is the way in.
const FENCE = '```';
const TWO_FIELDS = `above\n\n${FENCE}field\none\n${FENCE}\n\n${FENCE}field\ntwo\n${FENCE}\n\nbelow\n`;

test.describe('two boxes with editing surfaces of their own, back to back', () => {
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);

	test('Escape in the first field focuses its box whole, where Enter opens a paragraph below', async ({
		page
	}) => {
		await new PluginsPage(page).gotoPlugins('drawn');
		await page.evaluate((md) => (window as any).__test.setSource(md), TWO_FIELDS);
		const fields = page.locator('.drawn-field textarea');
		await expect(fields).toHaveCount(2);
		await clickInPlace(fields.first());
		await page.keyboard.press('Escape');
		await expect(fields.first()).not.toBeFocused();
		expect(await activeBlockPath(page)).toEqual([FIELD]);

		await page.keyboard.press('Enter');
		await page.keyboard.type('between');
		await expect
			.poll(() => source(page))
			.toBe(
				`above\n\n${FENCE}field\none\n${FENCE}\n\nbetween\n\n${FENCE}field\ntwo\n${FENCE}\n\nbelow\n`
			);
	});
});

test.describe('a fence drawn as a preview until the caret comes in', () => {
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);

	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
	});

	test('a click shows its text, and typing then leaving is one undo step', async ({ page }) => {
		const preview = page.locator('.drawn-preview');
		await expect(preview).toHaveText('preview: hello');
		await clickInPlace(preview);
		await expect(preview).toBeHidden();
		// The click opens the text at its start, the fence line; the body is the line below.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.type('XY');
		await clickInPlace(page.locator('[data-block-path="[0]"]'));
		await expect.poll(() => source(page)).toContain('```shown\nXYhello\n```');
		await expect(preview).toHaveText('preview: XYhello');

		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => source(page)).toContain('```shown\nhello\n```');
	});
});

test.describe("the drag ghost's name for a drawn block", () => {
	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
	});

	async function ghostOf(page: Page, path: number[]): Promise<string | null> {
		const host = page.locator(`[data-block-path="${JSON.stringify(path)}"]`).first();
		await hoverInPlace(host);
		const hb = (await host.locator(':scope > .block-drag-handle svg').boundingBox())!;
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + 120, hb.y + 60, { steps: 6 });
		const ghost = page.locator('.reorder-ghost');
		await expect(ghost).toBeVisible();
		const text = await ghost.textContent();
		await page.keyboard.press('Escape');
		await page.mouse.up();
		return text;
	}

	test('a box whose type declares dragLabel is called by it', async ({ page }) => {
		expect(await ghostOf(page, [FIELD])).toBe('A field box');
	});

	test('a fence whose type declares none shows its first words', async ({ page }) => {
		expect(await ghostOf(page, [3])).toBe('preview: hello');
	});
});

test.describe('a container drawn as a box around its children', () => {
	const ASIDE = 4;
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);

	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
	});

	test('typing in its child writes the marker back, and one Ctrl+Z takes it out', async ({
		page
	}) => {
		await expect(page.locator('.drawn-aside [data-block-path="[4,0]"]')).toHaveText('aside text');
		await placeCaret(page, [ASIDE, 0], 'end');
		await page.keyboard.type(' more');
		await expect.poll(() => source(page)).toMatch(/\n%> aside text more\n$/);

		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => source(page)).toMatch(/\n%> aside text\n$/);
	});

	test('Enter at the end of its child opens a marked child inside the box', async ({ page }) => {
		await placeCaret(page, [ASIDE, 0], 'end');
		await page.keyboard.press('Enter');
		await page.keyboard.type('word');
		// A marked blank line separates the two, as in a quote, or the word would continue the text.
		await expect.poll(() => source(page)).toMatch(/\n%> aside text\n%>\n%> word\n$/);
		expect(await caretPath(page)).toEqual([ASIDE, 1]);
	});
});

test.describe('a container drawn as a box, under typing and windowing', () => {
	const ASIDE = 4;
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);
	const updates = (page: Page): Promise<number> =>
		page.evaluate(() => (window as any).__drawnLog?.updates.aside ?? 0);

	test('typing in its child tells its drawing once per key', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
		// After the caret is in: its arrival is an update of its own.
		await placeCaret(page, [ASIDE, 0], 'end');
		await editor.waitForRenderFlush();
		const before = await updates(page);
		await page.keyboard.type('abc');
		await expect.poll(() => source(page)).toMatch(/\n%> aside textabc\n$/);
		expect((await updates(page)) - before).toBe(3);
	});

	test('its own children window inside its box, and mount as they scroll in', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
		const children = Array.from({ length: 400 }, (_, i) => `%> Child ${i} lorem ipsum dolor`);
		await editor.loadContent(children.join('\n%>\n') + '\n');
		const mounted = (path: string) => page.locator(`.drawn-aside [data-block-path='${path}']`);
		await expect(mounted('[0,1]')).toHaveCount(1);
		expect(await page.locator(".drawn-aside [data-block-path^='[0,']").count()).toBeLessThan(400);
		expect(await page.locator('.drawn-aside .vr-spacer').count()).toBeGreaterThan(0);

		await editor.scrollEditorTo(1_000_000);
		await expect(mounted('[0,399]')).toHaveCount(1);
		await expect(mounted('[0,1]')).toHaveCount(0);
	});
});

test.describe('a drawn text block with chrome, and a box drawn whole', () => {
	const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);
	const log = (page: Page): Promise<Record<string, Record<string, number>>> =>
		page.evaluate(() => structuredClone((window as any).__drawnLog ?? {}));
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('drawn');
	});

	test('typing in the memo writes its text and none of its badge; undo takes it back', async ({
		page
	}) => {
		await editor.loadContent('before\n\n@@ memo text\n\nafter\n');
		await editor.focusBlockEnd(1);
		await page.keyboard.type('!');
		await expect.poll(() => source(page)).toBe('before\n\n@@ memo text!\n\nafter\n');

		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => source(page)).toBe('before\n\n@@ memo text\n\nafter\n');
	});

	test('a selection over the badge paints exactly the box it drew', async ({ page }) => {
		await editor.loadContent('before\n\n[[badge]]\n\nafter\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press(extendKey('docEnd'));
		await editor.waitForCrossBlock(true);

		const overlay = page.locator(`[data-block-path='[1]'] .selection-overlay-middle`);
		await expect(overlay).toHaveCount(1);
		const painted = (await overlay.boundingBox())!;
		const drawn = (await page.locator(`[data-block-path='[1]'] .drawn-badge`).boundingBox())!;
		expect(drawn.height).toBeGreaterThan(0);
		for (const edge of ['x', 'y', 'width', 'height'] as const) {
			expect(Math.abs(painted[edge] - drawn[edge])).toBeLessThanOrEqual(1);
		}
	});

	test('the badge scrolled out of the window is torn down, and drawn again on the way back', async ({
		page
	}) => {
		const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor`);
		await editor.loadContent(['[[badge]]', ...filler].join('\n\n') + '\n');
		const badge = page.locator("[data-block-path='[0]'] .drawn-badge");
		await expect(badge).toHaveCount(1);
		const start = await log(page);

		await editor.scrollEditorTo(1_000_000);
		await expect(badge).toHaveCount(0);
		expect((await log(page)).destroys.badge).toBe((start.destroys?.badge ?? 0) + 1);

		await editor.scrollEditorTo(0);
		await expect(badge).toHaveCount(1);
		expect((await log(page)).mounts.badge).toBe(start.mounts.badge + 1);
	});

	test('ArrowRight out of the badge ends the column the ArrowDown into it kept', async ({
		page
	}) => {
		await editor.loadContent('abcdefghijklmnop\n\n[[badge]]\n\n0123456789abcdef\n\nzyxwvutsrq\n');
		const caret = async () => (await editor.bridge.getSelectionPaths())?.focus ?? null;
		await editor.focusBlock(0, 10);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('ArrowRight');
		await expect.poll(caret).toEqual({ path: [2], offset: 0 });
		await page.keyboard.press('ArrowDown');
		await expect.poll(caret).toEqual({ path: [3], offset: 0 });
	});
});

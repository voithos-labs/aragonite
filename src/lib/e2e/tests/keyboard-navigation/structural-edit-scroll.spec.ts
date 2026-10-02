// A key that changes blocks mid-screen keeps your place: a reorder or Enter leaves the page where it
// was, and an edit between the top of the screen and the caret keeps the caret's line still.
import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

const TALL = `p20 ${'tall '.repeat(90)}`.trim();
const LABELS = Array.from({ length: 40 }, (_, i) => (i === 20 ? TALL : `p${i} split here`));

const scrollTopOf = (page: Page) =>
	page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);

/** The top and height of the innermost mounted block whose text holds `label`, marker and all. */
const boxOf = (page: Page, label: string) =>
	page.evaluate((l) => {
		const hosts = [...document.querySelectorAll('[data-block-path]')].filter((h) =>
			(h.textContent ?? '').includes(`${l} `)
		);
		if (hosts.length === 0) throw new Error(`${l} is not mounted`);
		const host = hosts.reduce((a, b) => (b.textContent!.length < a.textContent!.length ? b : a));
		const r = host.getBoundingClientRect();
		return { top: r.top, height: r.height };
	}, label);

async function settle(editor: EditorPage): Promise<void> {
	await editor.waitForRenderFlush();
	await editor.waitForRenderFlush();
}

test.describe('a keyboard edit mid-screen keeps your place', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LABELS.join('\n\n') + '\n');
		await settle(editor);
		// The tall block mid-screen, and the viewport's top partway into a block above it.
		const tallTop = (await boxOf(page, 'p20')).top;
		const viewTop = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).getBoundingClientRect().top
		);
		await editor.scrollEditorTo(Math.round((await scrollTopOf(page)) + tallTop - viewTop - 260));
		await settle(editor);
		expect(await scrollTopOf(page)).toBeGreaterThan(0);
	});

	const clickInto = (page: Page, label: string) =>
		page.locator('[contenteditable="true"]', { hasText: `${label} split here` }).click();

	test('Alt+ArrowUp moves the block up past its tall sibling and leaves the page', async ({
		page
	}) => {
		await clickInto(page, 'p21');
		await settle(editor);
		const scrollTop = await scrollTopOf(page);
		const moved = await boxOf(page, 'p21');
		const sibling = await boxOf(page, 'p20');

		await page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceContains(`p21 split here\n\n${TALL}`);
		await settle(editor);

		const now = { scrollTop: await scrollTopOf(page), top: (await boxOf(page, 'p21')).top };
		console.log(`Alt+ArrowUp ${JSON.stringify({ scrollTop, moved, sibling, now })}`);
		expect(Math.abs(now.scrollTop - scrollTop)).toBeLessThan(1);
		expect(Math.abs(now.top - (moved.top - sibling.height))).toBeLessThan(2);
	});

	test('Enter at the end of a block Alt+ArrowUp just moved leaves the page and its line', async ({
		page
	}) => {
		await clickInto(page, 'p21');
		await page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceContains(`p21 split here\n\n${TALL}`);
		await settle(editor);
		const scrollTop = await scrollTopOf(page);
		const line = (await boxOf(page, 'p21')).top;

		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(LABELS.length + 1);
		await settle(editor);

		expect(Math.abs((await scrollTopOf(page)) - scrollTop)).toBeLessThan(1);
		expect(Math.abs((await boxOf(page, 'p21')).top - line)).toBeLessThan(1);
	});

	test('Alt+ArrowDown moves the block down past its tall sibling and leaves the page', async ({
		page
	}) => {
		await clickInto(page, 'p19');
		await settle(editor);
		const scrollTop = await scrollTopOf(page);
		const moved = await boxOf(page, 'p19');
		const sibling = await boxOf(page, 'p20');

		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceContains(`${TALL}\n\np19 split here`);
		await settle(editor);

		const now = { scrollTop: await scrollTopOf(page), top: (await boxOf(page, 'p19')).top };
		console.log(`Alt+ArrowDown ${JSON.stringify({ scrollTop, moved, sibling, now })}`);
		expect(Math.abs(now.scrollTop - scrollTop)).toBeLessThan(1);
		expect(Math.abs(now.top - (moved.top + sibling.height))).toBeLessThan(2);
	});

	for (const [where, walk] of [
		['at the start of the line', ['Home']],
		['in the middle of the line', ['Home', 'ArrowRight', 'ArrowRight', 'ArrowRight']]
	] as const) {
		test(`Enter ${where} leaves the line above where it was`, async ({ page }) => {
			await clickInto(page, 'p22');
			for (const key of walk) await page.keyboard.press(key);
			await settle(editor);
			const above = (await boxOf(page, 'p21')).top;

			await page.keyboard.press('Enter');
			await editor.bridge.waitForBlockCount(LABELS.length + 1);
			await settle(editor);

			expect(Math.abs((await boxOf(page, 'p21')).top - above)).toBeLessThan(1);
		});
	}

	test('undo bringing back a block between the top and the caret keeps the caret’s line still', async ({
		page
	}) => {
		// Delete the tall block by keyboard: clear its text, then join the empty line up.
		await page.locator('[contenteditable="true"]', { hasText: 'p20 tall' }).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForBlockCount(LABELS.length - 1);
		await clickInto(page, 'p24');
		await settle(editor);
		// Focus inside a block at the commit, or the rule never sees a caret to hold.
		expect(await page.evaluate(() => !!document.activeElement?.closest('[data-block-path]'))).toBe(
			true
		);
		const caretLine = (await boxOf(page, 'p24')).top;

		await page.keyboard.press('Control+z');
		await editor.bridge.waitForBlockCount(LABELS.length);
		await settle(editor);

		expect(Math.abs((await boxOf(page, 'p24')).top - caretLine)).toBeLessThan(1);
	});
});

test.describe('a reorder inside a container whose top is above the viewport leaves the page', () => {
	const items = (label: string) =>
		Array.from({ length: 60 }, (_, i) => {
			const name = `${label}${String(i).padStart(2, '0')}`;
			return i === 30 ? `${name} ${'tall '.repeat(90)}`.trim() : `${name} split here`;
		});

	for (const [kind, markdown, label] of [
		['quote', items('q').join('\n>\n> '), 'q'],
		['list', items('l').join('\n- '), 'l']
	] as const) {
		test(`Alt+ArrowUp in a ${kind} moves the block up past its tall sibling`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(`${kind === 'quote' ? '> ' : '- '}${markdown}\n`);
			await settle(editor);
			const [tall, moving] = [`${label}30`, `${label}31`];
			// Scroll a screen at a time until the tall item mounts, then put it mid-screen.
			for (let step = 0; step < 40 && !(await isMounted(page, tall)); step++) {
				await editor.scrollEditorTo(
					await page.evaluate(() => {
						const ed = document.querySelector('.editor') as HTMLElement;
						return ed.scrollTop + ed.clientHeight * 0.7;
					})
				);
			}
			const viewTop = await page.evaluate(
				() => (document.querySelector('.editor') as HTMLElement).getBoundingClientRect().top
			);
			const tallTop = (await boxOf(page, tall)).top;
			await editor.scrollEditorTo(Math.round((await scrollTopOf(page)) + tallTop - viewTop - 260));
			await settle(editor);
			// The container's top above the viewport is what puts this list's own top inside it.
			const containerTop = await page.evaluate(
				() => document.querySelector("[data-block-path='[0]']")!.getBoundingClientRect().top
			);
			expect(containerTop).toBeLessThan(viewTop);

			await page.locator('[contenteditable="true"]', { hasText: `${moving} split here` }).click();
			await settle(editor);
			const scrollTop = await scrollTopOf(page);
			const moved = await boxOf(page, moving);
			const sibling = await boxOf(page, tall);

			await page.keyboard.press('Alt+ArrowUp');
			await editor.bridge.waitForSource((s) => s.indexOf(moving) < s.indexOf(`${tall} tall`));
			await settle(editor);

			expect(Math.abs((await scrollTopOf(page)) - scrollTop)).toBeLessThan(1);
			expect(Math.abs((await boxOf(page, moving)).top - (moved.top - sibling.height))).toBeLessThan(
				3
			);
		});
	}
});

const isMounted = (page: Page, label: string) =>
	page.evaluate(
		(l) =>
			[...document.querySelectorAll('[data-block-path]')].some((h) =>
				(h.textContent ?? '').includes(`${l} `)
			),
		label
	);

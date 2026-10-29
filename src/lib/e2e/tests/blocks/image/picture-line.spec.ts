import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { textRunRect } from '../../../text-runs';
import { attachIme } from '../../../simulation/ime';
import { skipUnlessSupported } from '../../../browser-engine';
import { waitForAllImagesLoaded } from './helpers';

// Requirements: `requirements/blocks/image/picture-line.md`.

const IMG = '![x](/test-fixtures/photos/field-120x80.png)';
const LINKED = '[![alt](/test-fixtures/photos/field-120x80.png)](https://x.y)';

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

async function pictureBox(page: Page): Promise<Box> {
	await waitForAllImagesLoaded(page);
	const box = (await page.locator('[data-image-widget]').first().boundingBox())!;
	return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

/** After Backspace on the empty paragraph below, or a click past the picture's right edge. */
type Arrival = 'backspace' | 'click';

async function arriveAfter(editor: EditorPage, page: Page, arrival: Arrival): Promise<void> {
	if (arrival === 'backspace') {
		await editor.focusBlockStart(1);
		await page.keyboard.press('Backspace');
	} else {
		const picture = await pictureBox(page);
		await page.mouse.click(picture.right + 60, (picture.top + picture.bottom) / 2);
	}
	await editor.waitForRenderFlush();
}

const AFTER_ROWS = [
	{ name: 'a lone picture', source: IMG, path: [0] },
	{ name: 'a picture in a list item', source: `- ${IMG}`, path: [0, 0, 0] },
	{ name: 'a picture in a quote', source: `> ${IMG}`, path: [0, 0] }
];

test.describe('a picture sits in its line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const row of AFTER_ROWS) {
		for (const arrival of ['backspace', 'click'] as const) {
			// Backspace from below merges top-level paragraphs only.
			if (arrival === 'backspace' && row.path.length > 1) continue;
			test(`a letter typed after ${row.name} (${arrival}) lands on its line`, async ({ page }) => {
				await editor.loadContent(
					`${row.source}\n\n${arrival === 'backspace' ? '\n\n' : ''}after\n`
				);
				const picture = await pictureBox(page);
				await arriveAfter(editor, page, arrival);
				await page.keyboard.type('Q');
				await expect.poll(() => editor.bridge.getSource()).toContain(`${IMG}Q`);
				const q = await textRunRect(page, 'Q', { path: row.path });
				expect(Math.abs(q.left - picture.right), `left ${q.left} vs ${picture.right}`).toBeLessThan(
					1
				);
				expect(q.top).toBeGreaterThan(picture.top);
				expect(q.top).toBeLessThan(picture.bottom);
			});
		}
	}

	test('a letter typed before a lone picture lands on its line', async ({ page }) => {
		await editor.loadContent(`${IMG}\n\nafter\n`);
		const before = await pictureBox(page);
		await editor.focusBlockStart(0);
		await page.keyboard.type('Q');
		await expect.poll(() => editor.bridge.getSource()).toContain(`Q${IMG}`);
		const q = await textRunRect(page, 'Q', { path: [0] });
		const picture = await pictureBox(page);
		expect(Math.abs(q.left - before.left), `left ${q.left} vs ${before.left}`).toBeLessThan(1);
		expect(q.top).toBeGreaterThan(picture.top);
		expect(q.top).toBeLessThan(picture.bottom);
	});

	for (const [name, source] of [
		['a lone picture', IMG],
		['a linked picture', LINKED]
	]) {
		test(`${name} alone in its paragraph leaves no gap under it`, async ({ page }) => {
			await editor.loadContent(`${source}\n\nafter\n`);
			const picture = await pictureBox(page);
			const paragraph = await page.evaluate(() => {
				const widget = document.querySelector('[data-image-widget]')!;
				const block = widget.closest('[contenteditable="true"]')!;
				const style = getComputedStyle(widget);
				const r = block.getBoundingClientRect();
				const pad = getComputedStyle(block);
				return {
					content: r.height - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom),
					margins: parseFloat(style.marginTop) + parseFloat(style.marginBottom)
				};
			});
			const framed = picture.bottom - picture.top + paragraph.margins;
			expect(
				Math.abs(paragraph.content - framed),
				`${paragraph.content} vs ${framed}`
			).toBeLessThan(1);
		});
	}

	for (const arrival of ['backspace', 'click'] as const) {
		test(`the browser holds a caret after a lone picture (${arrival})`, async ({ page }) => {
			await editor.loadContent(`${IMG}\n\n${arrival === 'backspace' ? '\n\n' : ''}after\n`);
			await arriveAfter(editor, page, arrival);
			const caret = await page.evaluate(() => {
				const sel = getSelection();
				const paragraph = document
					.querySelector('[data-image-widget]')!
					.closest('[contenteditable="true"]');
				return (
					!!sel && sel.rangeCount > 0 && sel.isCollapsed && !!paragraph?.contains(sel.focusNode)
				);
			});
			expect(caret).toBe(true);
		});
	}

	const COMPOSE_ROWS = [
		{ name: 'after a lone picture (backspace)', arrive: 'backspace', typed: `${IMG}你` },
		{ name: 'after a lone picture (click)', arrive: 'click', typed: `${IMG}你` },
		{ name: 'before a lone picture', arrive: 'start', typed: `你${IMG}` }
	] as const;

	for (const row of COMPOSE_ROWS) {
		test(`an input method composes ${row.name}`, async ({ page }) => {
			// A composition the browser refuses to start only shows through CDP's.
			skipUnlessSupported(page, 'cdp');
			test.setTimeout(20_000);
			await editor.loadContent(`${IMG}\n\n${row.arrive === 'backspace' ? '\n\n' : ''}after\n`);
			if (row.arrive === 'start') await editor.focusBlockStart(0);
			else await arriveAfter(editor, page, row.arrive);
			await page.evaluate(() => {
				const w = window as unknown as { __started: number };
				w.__started = 0;
				document.addEventListener('compositionstart', () => w.__started++, true);
			});
			const ime = await attachIme(page);
			await ime.compose('你');
			await ime.commit('你');
			await expect.poll(() => editor.bridge.getSource()).toContain(row.typed);
			expect(await page.evaluate(() => (window as any).__started)).toBe(1);
		});
	}
});

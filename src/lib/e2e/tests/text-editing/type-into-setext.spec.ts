import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';

// Typing into a setext heading keeps its underline. No mode draws the underline, so the text the
// block reads back from its DOM stops at the title and the write has to put the underline back
// (`requirements/text-editing/type-into-setext.md`).

async function open(page: Page, mode: 'source' | 'live', doc: string): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(mode === 'live' ? '?presentationMode=live' : '');
	await ep.loadContent(doc);
	return ep;
}

const kindAt = (page: Page, path: number[]) =>
	page.locator(`[data-block-path='${JSON.stringify(path)}']`).getAttribute('data-block-kind');

// Polled rather than waited on, so a red prints the bytes the editor wrote.
const expectSource = (ep: EditorPage, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: typing into a setext heading`, () => {
		for (const underline of ['---', '===', '----------']) {
			test(`End then a character keeps a ${underline} underline`, async ({ page }) => {
				const ep = await open(page, mode, `Plan\n${underline}\n`);
				await ep.clickBlock(0);
				await page.keyboard.press('End');
				await page.keyboard.type('s');

				await expectSource(ep, `Plans\n${underline}\n`);
				expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
			});
		}

		test('Home then a character keeps the underline', async ({ page }) => {
			const ep = await open(page, mode, 'Plan\n---\n');
			await ep.clickBlock(0);
			await page.keyboard.press('Home');
			await page.keyboard.type('s');

			await expectSource(ep, 'sPlan\n---\n');
		});

		test('a heading inside a larger document keeps its underline and its neighbours', async ({
			page
		}) => {
			const ep = await open(page, mode, 'intro\n\nPlan\n===\n\nafter\n');
			await ep.clickBlock(1);
			await page.keyboard.press('End');
			await page.keyboard.type('s');

			await expectSource(ep, 'intro\n\nPlans\n===\n\nafter\n');
		});
	});
}

test.describe('typing into a setext heading: other shapes and routes', () => {
	test('a CRLF document keeps its underline and its endings', async ({ page }) => {
		const ep = await open(page, 'source', 'Plan\r\n===\r\n');
		await ep.clickBlock(0);
		await page.keyboard.press('End');
		await page.keyboard.type('s');

		await expectSource(ep, 'Plans\r\n===\r\n');
	});

	for (const [label, doc, path, typed] of [
		['a list item', '- Plan\n  ---\n', [0, 0, 0], '- Plans\n  ---\n'],
		['a quote', '> Plan\n> ===\n', [0, 0], '> Plans\n> ===\n']
	] as const) {
		test(`a heading inside ${label} keeps its underline`, async ({ page }) => {
			const ep = await open(page, 'live', doc);
			expect(await kindAt(page, [...path])).toBe('setextHeading');
			await ep.clickBlockAtPath([...path], 2);
			await page.keyboard.press('End');
			await page.keyboard.type('s');

			await expectSource(ep, typed);
		});
	}

	test('a paste at the title end keeps the underline', async ({ page }) => {
		const ep = await open(page, 'live', 'Plan\n---\n');
		await ep.seedClipboard('ned');
		await ep.clickBlock(0);
		await page.keyboard.press('End');
		await ep.paste();

		await expectSource(ep, 'Planned\n---\n');
	});

	test('an IME composition at the title end keeps the underline', async ({ page }) => {
		const ep = await open(page, 'live', 'Plan\n---\n');
		await ep.clickBlock(0);
		await page.keyboard.press('End');
		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('か');

		await expectSource(ep, 'Planか\n---\n');
	});

	test('one undo after typing puts the title back and keeps the underline', async ({ page }) => {
		const ep = await open(page, 'live', 'Plan\n---\n');
		await ep.clickBlock(0);
		await page.keyboard.press('End');
		await page.keyboard.type('s');
		await expectSource(ep, 'Plans\n---\n');

		await ep.undo();
		await expectSource(ep, 'Plan\n---\n');
	});
});

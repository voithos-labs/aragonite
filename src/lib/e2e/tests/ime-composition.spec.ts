import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { attachIme } from '../simulation/ime';

// Real IME composition over CDP, producing genuine compositionstart/update/end events
// (requirements/ime-composition.md). Chromium's order is pinned by the first test: every
// insertCompositionText fires with isComposing true before compositionend, and the commit to
// the tree afterwards comes from the block's own code, not from another DOM input event. These
// sequences are the first deliberate real-browser exercise of G1.27.

function countOf(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

test.describe('IME composition', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paragraph: source stays stable mid-composition; the commit lands once and round-trips', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		await page.evaluate(() => {
			const w = window as unknown as { __ime: string[] };
			w.__ime = [];
			const el = document.activeElement as HTMLElement;
			for (const type of ['compositionstart', 'compositionend']) {
				el.addEventListener(type, () => w.__ime.push(type));
			}
			el.addEventListener('input', (e) => w.__ime.push(`input:${(e as InputEvent).isComposing}`));
		});
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('hello world\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');
		const source = await editor.bridge.getSource();
		expect(countOf(source, 'かん')).toBe(1);
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);

		const events = await page.evaluate(() => (window as unknown as { __ime: string[] }).__ime);
		expect(events[0]).toBe('compositionstart');
		expect(events[events.length - 1]).toBe('compositionend');
		expect(events.slice(1, -1).every((e) => e === 'input:true')).toBe(true);
	});

	test('code block: composed commit lands in the body; Enter after it splices a newline', async ({
		page
	}) => {
		await editor.loadContent('```\ncode\n```\n');
		await editor.focusBlock(0, '```\ncode'.length);
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('codeかん');

		// The checks on insertLineBreak apply only while composing: once composition has ended,
		// Enter must put its newline into the body as usual.
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('codeかん\n\n```');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('table cell: composed commit updates the cell once and round-trips', async ({ page }) => {
		await editor.loadContent('| H |\n| :- |\n| Left |\n');
		await page.locator('.table-cell').nth(1).click();
		await page.keyboard.press('End');
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('| H |\n| :- |\n| Left |\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('| Leftかん |');
		expect(countOf(await editor.bridge.getSource(), 'かん')).toBe(1);
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('a composed commit over a selection replaces it, leaving one copy', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 'world'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
		const ime = await attachIme(page);

		await ime.compose('かん');
		await ime.commit('かん');

		await editor.bridge.waitForSourceEquals('hello かん\n');
	});

	test('undo after a composed commit restores the pre-composition text in one step', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		const ime = await attachIme(page);

		await ime.compose('かん');
		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');

		// One undo entry per composition: the commit goes through a single updateBlockContent,
		// whose debounced snapshot was taken before the composition started.
		await editor.undo();
		await editor.bridge.waitForSourceEquals('hello world\n');
	});
});

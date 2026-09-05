import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';

// The WebKit lane's composition arm (requirements/webkit/ime-composition.md): the commit funnel
// under a hand-fired sequence. Event ORDER is the CDP spec's claim, not this one's.

function countOf(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

test.describe('webkit: composition through the hand-fired arm', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a paragraph commit lands once and leaves the source stable mid-composition', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('hello world\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');
		expect(countOf(await editor.bridge.getSource(), 'かん')).toBe(1);
	});

	test('an aborted composition leaves the pre-composition source', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.abort();

		// No commit runs, so no source predicate can settle on the abort; the block's own text
		// is what the window wrote, and it must lose the candidate.
		await editor.page.waitForFunction(
			() => (document.activeElement?.textContent ?? '') === 'hello world',
			null,
			{ timeout: 2000, polling: 16 }
		);
		expect(await editor.bridge.getSource()).toBe('hello world\n');
	});

	test('a commit at a live construct edge lands inside the run and keeps its delimiters', async ({
		page
	}) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('a **bold**\n');
		await editor.focusBlockEnd(0);
		const ime = await attachIme(page);

		await ime.compose('か');
		expect(await editor.bridge.getSource()).toBe('a **bold**\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceEquals('a **boldかん**\n');
	});
});

// A list of the caret's list's type pasted at an item's text, through a real paste: its first item
// joins the caret's line, the rest land as items numbered on, and a last line ending opens the next
// item as Enter does. The core's rows are `test/range-edit/named-rows.ts` and
// `test/range-edit/paste-ending-enter.test.ts`.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('paste: same-type list into a list item', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const pasteAtAlpha = async (clip: string) => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.seedClipboard(clip);
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.paste();
	};
	const source = async () => (await editor.bridge.getSource()).replace(/\r\n/g, '\n');

	test('ordered paste at the end of an ordered item joins its first item there', async () => {
		await pasteAtAlpha('1. x\n2. y');
		await editor.bridge.waitForSourceMatches(/^3\. beta$/m);
		expect(await source()).toBe('1. alphax\n2. y\n3. beta\n');
	});

	test('a last line ending opens the next item, empty, with the caret in it', async () => {
		await pasteAtAlpha('1. x\n2. y\n');
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);
		expect(await source()).toBe('1. alphax\n2. y\n3. \n4. beta\n');
		await editor.page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/^3\. Z$/m);
		expect(await source()).toBe('1. alphax\n2. y\n3. Z\n4. beta\n');
	});

	test('a paste into an empty item lands the items as items', async () => {
		await editor.loadContent('1. alpha\n2. \n3. beta\n');
		await editor.seedClipboard('1. x\n2. y');
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);
		expect(await source()).toBe('1. alpha\n2. x\n3. y\n4. beta\n');
	});

	// `$state` proxies wrap entries lazily, so a renumber on freshly inserted items misses the set
	// trap; the drawn markers are checked against the source's.
	test('DOM ambient markers match source markers after the paste', async () => {
		await editor.loadContent('1. Ordered first\n2. Ordered second\n3. Ordered third\n');
		await editor.seedClipboard('1. first\n2. Ordered second\n3. Ordered\n');

		await editor.focusBlockAtPath([0, 2, 0], 'Ordered'.length);
		await editor.paste();
		await editor.waitForListItemCount(6);

		const domMarkers = await editor.page.evaluate(() => {
			const items = document.querySelectorAll('.list-item-block');
			return Array.from(items).map((it) => it.querySelector('.md-marker')?.textContent ?? '?');
		});
		const sourceMarkers = (await source()).match(/^\d+\. +/gm);
		expect(domMarkers).toEqual(sourceMarkers);
		expect(domMarkers).toHaveLength(6);
	});
});

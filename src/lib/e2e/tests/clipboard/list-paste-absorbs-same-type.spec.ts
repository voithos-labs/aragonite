// A same-type list paste flattening into the enclosing list, through a real paste. The positions,
// shapes and marker styles are `test/tree-operations/paste/list-absorb-rows.test.ts`.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Flattens pasted items as siblings with continuous renumbering, never separate lists or a nested
// sub-list; the mismatched-type counterpart is `list-paste-mismatched-breaks-out.spec.ts`.
test.describe('paste: same-type list into list item flattens into enclosing list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered paste at end of ordered item: items absorb with continuous numbering', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.seedClipboard('1. x\n2. y\n');

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		for (const line of [/^1\. alpha$/m, /^2\. x$/m, /^3\. y$/m, /^4\. beta$/m]) {
			expect(src).toMatch(line);
		}
		// The pasted list must not stay its own list (restarting at 1), nor the outer list resume
		// numbering after the gap.
		expect(src).not.toMatch(/^1\. x$/m);
		expect(src).not.toMatch(/^2\. beta$/m);
	});

	// `$state` proxies wrap entries lazily, so a renumber on freshly inserted items misses the set
	// trap; the final markers are worked out before the splice, on items already wrapped.
	test('DOM ambient markers match source markers after absorb', async () => {
		await editor.loadContent('1. Ordered first\n2. Ordered second\n3. Ordered third\n');
		await editor.seedClipboard('1. first\n2. Ordered second\n3. Ordered\n');

		await editor.focusBlockAtPath([0, 2, 0], 'Ordered'.length);
		await editor.paste();
		await editor.waitForListItemCount(7);

		const domMarkers = await editor.page.evaluate(() => {
			const items = document.querySelectorAll('.list-item-block');
			return Array.from(items).map((it) => it.querySelector('.md-marker')?.textContent ?? '?');
		});
		expect(domMarkers).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7.  ']);
	});
});

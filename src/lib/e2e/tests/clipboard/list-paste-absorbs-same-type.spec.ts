// Single concern: same-type list paste flattens into the enclosing list with continuous renumbering.
// Each test exercises a paste-position / shape variant (start/middle/end, mismatched marker suffix,
// trailing-newline absence, DOM ambient sync, single-item) of the one invariant; they cluster as
// parametric variants and stay together for cohesion.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Same-type list paste (ordered into ordered, unordered into unordered) should
// flatten pasted items as siblings in the enclosing list with continuous
// renumbering — not produce three separate lists (break-out) and not nest as
// a sub-list under the target item. Matches Obsidian / Google Docs convention.
// The complementary mismatched-type case is covered by
// list-paste-mismatched-breaks-out.spec.ts.
test.describe('paste: same-type list into list item flattens into enclosing list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered paste at end of ordered item: items absorb with continuous numbering', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. beta$/m);
		// Regressions to guard: pasted list staying its own list (1-restart)
		// or outer list resuming numbering after the gap.
		expect(src).not.toMatch(/^1\. x$/m);
		expect(src).not.toMatch(/^2\. beta$/m);
	});

	test('ordered paste in middle of ordered item: item splits and pasted items absorb between halves', async () => {
		await editor.loadContent('1. alphagamma\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^4\. gamma$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. gamma$/m);
		expect(src).toMatch(/^5\. beta$/m);
	});

	test('ordered paste at start of ordered item: items absorb before target', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. x$/m);
		expect(src).toMatch(/^2\. y$/m);
		expect(src).toMatch(/^3\. alpha$/m);
		expect(src).toMatch(/^4\. beta$/m);
	});

	test('ordered paste at end of middle item: pasted items land between target and rest', async () => {
		await editor.loadContent('1. a\n2. b\n3. c\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));

		await editor.focusBlockAtPath([0, 1, 0], 'b'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^5\. c$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		expect(src).toMatch(/^3\. x$/m);
		expect(src).toMatch(/^4\. y$/m);
		expect(src).toMatch(/^5\. c$/m);
	});

	test('unordered paste at end of unordered item: items absorb as flat siblings', async () => {
		await editor.loadContent('- a\n- b\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('- x\n- y\n'));

		await editor.focusBlockAtPath([0, 0, 0], 'a'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) ?? []).length === 4);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- a$/m);
		expect(src).toMatch(/^- x$/m);
		expect(src).toMatch(/^- y$/m);
		expect(src).toMatch(/^- b$/m);
		// All 4 items in a single flat list — exactly 4 bullet lines.
		const bulletLines = (src.match(/^- /gm) ?? []).length;
		expect(bulletLines).toBe(4);
	});

	test('ordered paste with mismatched marker suffix normalizes to parent style', async () => {
		// Parent uses "1. " suffix; paste uses "1) " suffix. After absorb,
		// all items should share the parent's "." suffix.
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1) x\n2) y\n'));

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^4\. beta$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. beta$/m);
		// No ")" suffix survives in the absorbed items.
		expect(src).not.toMatch(/^\d+\) /m);
	});

	// Regression: when the clipboard lacks a trailing newline, the parser
	// produces a last pasted item whose raw has no trailing \n. Splicing that
	// item into a non-tail position caused rebuildListRaw to concatenate it
	// with the next sibling, mashing them into one item like "6. Ordered7. third".
	test('ordered paste without trailing newline still absorbs as separate items', async () => {
		await editor.loadContent('1. Ordered first\n2. Ordered second\n3. Ordered third\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('1. first\n2. Ordered second\n3. Ordered')
		);

		await editor.focusBlockAtPath([0, 2, 0], 'Ordered'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^7\. third$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. Ordered first$/m);
		expect(src).toMatch(/^2\. Ordered second$/m);
		expect(src).toMatch(/^3\. Ordered$/m);
		expect(src).toMatch(/^4\. first$/m);
		expect(src).toMatch(/^5\. Ordered second$/m);
		expect(src).toMatch(/^6\. Ordered$/m);
		expect(src).toMatch(/^7\. third$/m);
		// Buggy state produced "6. Ordered7. third" as a merged line.
		expect(src).not.toMatch(/^6\. Ordered7\./m);
	});

	// Regression: Svelte 5's $state proxies wrap entries lazily on access.
	// Mutations to freshly-inserted (un-proxied) items bypass the set trap,
	// so a post-splice renumberOrderedList didn't propagate to the DOM —
	// the source reflected new markers (1..7) but rendered ambient prefixes
	// stayed on the cloned-original values (1,2,3,1,2,3,3). Pre-computing
	// final markers before splice keeps all reactive mutations on existing
	// (already-proxied) items.
	test('DOM ambient markers match source markers after absorb', async () => {
		await editor.loadContent('1. Ordered first\n2. Ordered second\n3. Ordered third\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('1. first\n2. Ordered second\n3. Ordered\n')
		);

		await editor.focusBlockAtPath([0, 2, 0], 'Ordered'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForFunction(
			() => document.querySelectorAll('.list-item-block').length === 7,
			null,
			{ timeout: 2000 }
		);

		const domMarkers = await editor.page.evaluate(() => {
			const items = document.querySelectorAll('.list-item-block');
			return Array.from(items).map((it) => it.querySelector('.md-marker')?.textContent ?? '?');
		});
		expect(domMarkers).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ']);
	});

	test('single-item ordered paste at end of ordered item absorbs as one sibling', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. only\n'));

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^3\. beta$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. only$/m);
		expect(src).toMatch(/^3\. beta$/m);
	});

	// Regression: a list that doesn't start at 1 must keep counting from its own
	// base — the absorb path hardcoded base 1, so pasting into `3. 4. 5.` restarted
	// the region at the item index and produced duplicate markers (3,4,3,4,5).
	test('ordered paste into a non-1-based list preserves the start number', async () => {
		await editor.loadContent('3. a\n4. b\n5. c\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));

		await editor.focusBlockAtPath([0, 2, 0], 'c'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/^7\. y$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^3\. a$/m);
		expect(src).toMatch(/^4\. b$/m);
		expect(src).toMatch(/^5\. c$/m);
		expect(src).toMatch(/^6\. x$/m);
		expect(src).toMatch(/^7\. y$/m);
		// Buggy state renumbered c→3, duplicating the leading 3 and 4.
		expect(src).not.toMatch(/^3\. c$/m);
		expect((src.match(/^3\. /gm) ?? []).length).toBe(1);
	});
});

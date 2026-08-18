// One invariant — same-type list paste flattening into the enclosing list — parametrized
// across paste positions and shapes, which is why these stay in one file.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

interface AbsorbRow {
	name: string;
	doc: string;
	clip: string;
	focus: number[];
	offset: number;
	settle: RegExp | ((s: string) => boolean);
	expected: RegExp[];
	rejected?: RegExp[];
}

const ROWS: AbsorbRow[] = [
	{
		name: 'ordered paste at end of ordered item: items absorb with continuous numbering',
		doc: '1. alpha\n2. beta\n',
		clip: '1. x\n2. y\n',
		focus: [0, 0, 0],
		offset: 'alpha'.length,
		settle: /^4\. beta$/m,
		expected: [/^1\. alpha$/m, /^2\. x$/m, /^3\. y$/m, /^4\. beta$/m],
		// Regressions to guard: pasted list staying its own list (1-restart)
		// or outer list resuming numbering after the gap.
		rejected: [/^1\. x$/m, /^2\. beta$/m]
	},
	{
		name: 'ordered paste in middle of ordered item: item splits and pasted items absorb between halves',
		doc: '1. alphagamma\n2. beta\n',
		clip: '1. x\n2. y\n',
		focus: [0, 0, 0],
		offset: 'alpha'.length,
		settle: /^4\. gamma$/m,
		expected: [/^1\. alpha$/m, /^2\. x$/m, /^3\. y$/m, /^4\. gamma$/m, /^5\. beta$/m]
	},
	{
		name: 'ordered paste at start of ordered item: items absorb before target',
		doc: '1. alpha\n2. beta\n',
		clip: '1. x\n2. y\n',
		focus: [0, 0, 0],
		offset: 0,
		settle: /^4\. beta$/m,
		expected: [/^1\. x$/m, /^2\. y$/m, /^3\. alpha$/m, /^4\. beta$/m]
	},
	{
		name: 'ordered paste at end of middle item: pasted items land between target and rest',
		doc: '1. a\n2. b\n3. c\n',
		clip: '1. x\n2. y\n',
		focus: [0, 1, 0],
		offset: 'b'.length,
		settle: /^5\. c$/m,
		expected: [/^1\. a$/m, /^2\. b$/m, /^3\. x$/m, /^4\. y$/m, /^5\. c$/m]
	},
	{
		name: 'unordered paste at end of unordered item: items absorb as flat siblings',
		doc: '- a\n- b\n',
		clip: '- x\n- y\n',
		focus: [0, 0, 0],
		offset: 'a'.length,
		// All 4 items in a single flat list — exactly 4 top-level bullet lines.
		settle: (s: string) => (s.match(/^- /gm) ?? []).length === 4,
		expected: [/^- a$/m, /^- x$/m, /^- y$/m, /^- b$/m]
	},
	{
		// Parent uses "1. " suffix; paste uses "1) ". After absorb, all items share the parent's.
		name: 'ordered paste with mismatched marker suffix normalizes to parent style',
		doc: '1. alpha\n2. beta\n',
		clip: '1) x\n2) y\n',
		focus: [0, 0, 0],
		offset: 'alpha'.length,
		settle: /^4\. beta$/m,
		expected: [/^1\. alpha$/m, /^2\. x$/m, /^3\. y$/m, /^4\. beta$/m],
		rejected: [/^\d+\) /m]
	},
	{
		// A clipboard without a trailing newline yields a last item whose raw lacks one, which
		// `rebuildListRaw` concatenates with the next sibling when spliced into a non-tail
		// position; the buggy state produced "6. Ordered7. third" as a merged line.
		name: 'ordered paste without trailing newline still absorbs as separate items',
		doc: '1. Ordered first\n2. Ordered second\n3. Ordered third\n',
		clip: '1. first\n2. Ordered second\n3. Ordered',
		focus: [0, 2, 0],
		offset: 'Ordered'.length,
		settle: /^7\. third$/m,
		expected: [
			/^1\. Ordered first$/m,
			/^2\. Ordered second$/m,
			/^3\. Ordered$/m,
			/^4\. first$/m,
			/^5\. Ordered second$/m,
			/^6\. Ordered$/m,
			/^7\. third$/m
		],
		rejected: [/^6\. Ordered7\./m]
	},
	{
		name: 'single-item ordered paste at end of ordered item absorbs as one sibling',
		doc: '1. alpha\n2. beta\n',
		clip: '1. only\n',
		focus: [0, 0, 0],
		offset: 'alpha'.length,
		settle: /^3\. beta$/m,
		expected: [/^1\. alpha$/m, /^2\. only$/m, /^3\. beta$/m]
	},
	{
		// A list that doesn't start at 1 keeps counting from its own base — the absorb path once
		// hardcoded base 1, restarting the region at the item index and duplicating markers.
		name: 'ordered paste into a non-1-based list preserves the start number',
		doc: '3. a\n4. b\n5. c\n',
		clip: '1. x\n2. y\n',
		focus: [0, 2, 0],
		offset: 'c'.length,
		settle: /^7\. y$/m,
		expected: [/^3\. a$/m, /^4\. b$/m, /^5\. c$/m, /^6\. x$/m, /^7\. y$/m],
		// Buggy state renumbered c→3, duplicating the leading 3.
		rejected: [/^3\. c$/m, /^3\. [\s\S]*^3\. /m]
	}
];

// Flattens pasted items as SIBLINGS with continuous renumbering — neither three separate
// lists nor a nested sub-list, matching the Obsidian / Google Docs convention. The
// mismatched-type complement is list-paste-mismatched-breaks-out.spec.ts.
test.describe('paste: same-type list into list item flattens into enclosing list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const row of ROWS) {
		test(row.name, async () => {
			await editor.loadContent(row.doc);
			await editor.seedClipboard(row.clip);

			await editor.focusBlockAtPath(row.focus, row.offset);
			await editor.paste('Control+v');
			if (row.settle instanceof RegExp) await editor.bridge.waitForSourceMatches(row.settle);
			else await editor.bridge.waitForSource(row.settle);

			const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
			for (const pattern of row.expected) expect(src).toMatch(pattern);
			for (const pattern of row.rejected ?? []) expect(src).not.toMatch(pattern);
		});
	}

	// `$state` proxies wrap entries LAZILY, so mutating freshly-inserted items bypasses the
	// set trap and a post-splice renumber never reaches the DOM. Pre-computing final markers
	// before the splice keeps every reactive mutation on already-proxied items.
	test('DOM ambient markers match source markers after absorb', async () => {
		await editor.loadContent('1. Ordered first\n2. Ordered second\n3. Ordered third\n');
		await editor.seedClipboard('1. first\n2. Ordered second\n3. Ordered\n');

		await editor.focusBlockAtPath([0, 2, 0], 'Ordered'.length);
		await editor.paste('Control+v');
		await editor.waitForListItemCount(7);

		const domMarkers = await editor.page.evaluate(() => {
			const items = document.querySelectorAll('.list-item-block');
			return Array.from(items).map((it) => it.querySelector('.md-marker')?.textContent ?? '?');
		});
		expect(domMarkers).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ']);
	});
});

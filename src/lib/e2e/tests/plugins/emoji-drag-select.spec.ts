import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * A drag that starts on an emoji selects, like a drag from any other character. The glyph is
 * `contenteditable=false` and `user-select: none`, so the browser starts no drag from it and
 * answers its point with a position in the neighbouring text: the editor paints the range itself,
 * anchored at the glyph's raw edge on the press's side.
 * Requirements: e2e/requirements/plugins/emoji-drag-select.md.
 */

const SOURCE = 'Mood :smile: today and more words\n';

interface Point {
	x: number;
	y: number;
}

/** A point in the glyph's trailing half, a point `dx` from its left edge on the same line, and the
 *  line's far end. The edge to anchor at is chosen by which half of the glyph the press is in, so
 *  a press at the exact centre would leave the anchor to sub-pixel rounding. */
async function emojiPoints(
	editor: PluginsPage
): Promise<{ trailingHalf: Point; from: (dx: number) => Point; lineEnd: Point }> {
	const box = await editor.page.locator('.md-emoji-widget').first().boundingBox();
	const block = await editor.getBlock(0).boundingBox();
	if (!box || !block) throw new Error('no layout box');
	const y = box.y + box.height / 2;
	return {
		trailingHalf: { x: box.x + box.width * 0.75, y },
		from: (dx) => ({ x: box.x + dx, y }),
		lineEnd: { x: block.x + block.width - 4, y }
	};
}

/** The range as the DOM holds it: written low-to-high, so neither end names the drag's side. */
async function selectedRange(editor: PluginsPage): Promise<{ low: number; high: number }> {
	const sel = await editor.bridge.getSelectionPaths();
	if (!sel) throw new Error('no selection');
	return {
		low: Math.min(sel.anchor.offset, sel.focus.offset),
		high: Math.max(sel.anchor.offset, sel.focus.offset)
	};
}

/** A real press-move-release; the moves are stepped so the drag session sees more than one. */
async function dragBetween(editor: PluginsPage, from: Point, to: Point): Promise<void> {
	await editor.page.mouse.move(from.x, from.y);
	await editor.page.mouse.down();
	for (let step = 1; step <= 6; step++) {
		await editor.page.mouse.move(
			from.x + ((to.x - from.x) * step) / 6,
			from.y + ((to.y - from.y) * step) / 6
		);
	}
	await editor.page.mouse.up();
	await editor.waitForRenderFlush();
}

const selectedText = (editor: PluginsPage) =>
	editor.page.evaluate(() => window.getSelection()?.toString() ?? '');

test.describe('a drag that starts on an emoji selects', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('emoji');
		await editor.loadContent(SOURCE);
	});

	test('dragging right off the glyph selects the text after it', async () => {
		const { trailingHalf, from } = await emojiPoints(editor);
		await dragBetween(editor, trailingHalf, from(200));

		expect(await selectedText(editor)).toContain('today');
		// Anchored at the glyph's own trailing edge, the raw offset after `:smile:`, so the glyph
		// itself stays out of a range that grows away from it.
		expect((await selectedRange(editor)).low).toBe(12);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('dragging left off the glyph selects the text before it', async () => {
		const { trailingHalf, from } = await emojiPoints(editor);
		await dragBetween(editor, trailingHalf, from(-45));

		expect(await selectedText(editor)).toContain('ood');
		const range = await selectedRange(editor);
		expect(range.high).toBe(12);
		expect(range.low).toBeLessThan(5);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('the drag paints no range until the pointer moves', async () => {
		const { trailingHalf } = await emojiPoints(editor);
		await editor.page.mouse.move(trailingHalf.x, trailingHalf.y);
		await editor.page.mouse.down();
		await editor.waitForRenderFlush();

		expect(await selectedText(editor)).toBe('');

		await editor.page.mouse.up();
		await editor.waitForRenderFlush();
		// A press with no drag is the click that puts a caret beside the glyph, not a selection.
		expect(await selectedText(editor)).toBe('');
		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('the selection a drag from the glyph paints is the one a key type-replaces', async () => {
		const { trailingHalf, lineEnd } = await emojiPoints(editor);
		await dragBetween(editor, trailingHalf, lineEnd);

		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('X');
		// The range went, the emoji and what stood before it stayed.
		expect(await editor.bridge.getSource()).toBe('Mood :smile:X\n');
	});
});

/** A drag from the trailing half of `selector`'s widget to a point `dx` further along its line. */
async function dragOffWidget(editor: PluginsPage, selector: string, dx: number): Promise<void> {
	const box = await editor.page.locator(selector).first().boundingBox();
	if (!box) throw new Error(`no layout box for ${selector}`);
	const y = box.y + box.height / 2;
	await dragBetween(editor, { x: box.x + box.width * 0.75, y }, { x: box.x + box.width + dx, y });
}

// The rule is declared per kind, not per component: any widget the caret reads as one character
// drags, and one running a pointer gesture of its own keeps its press. Each sibling of the emoji
// is here as its own case, so a widening of that declaration reds rather than passing silently.
test.describe('the same drag from the emoji’s siblings', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('emoji');
	});

	test('a drag from an entity glyph selects the text after it', async () => {
		await editor.loadContent('Mood &amp; today and more words\n');
		await dragOffWidget(editor, '.md-entity-widget', 200);

		expect(await selectedText(editor)).toContain('today');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('a drag from an inline formula selects the text after it', async () => {
		await editor.loadContent('Mood $x^2$ today and more words\n');
		await dragOffWidget(editor, '.math-inline-widget', 200);

		expect(await selectedText(editor)).toContain('today');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	// The exclusion, pinned from the other side: the image owns its press for the resize drag, so
	// a range painted under it would fight that gesture.
	test('a drag from an inline image paints no range of its own', async () => {
		const source = 'Mood ![a|60x40](/test-fixtures/sample.png) today and more words\n';
		await editor.loadContent(source);
		await editor.page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		await dragOffWidget(editor, '[data-image-widget]', 200);

		expect(await selectedText(editor)).toBe('');
		// Nor did the gesture reach a resize handle, which would have rewritten the dimensions.
		expect(await editor.bridge.getSource()).toBe(source);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});
});

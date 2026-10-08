import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { textRunRect } from '../../text-runs';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';

// The handle is for the mouse alone: one per block that is an object (code, table, picture,
// equation, list item, divider) rather than prose, and out of the screen-reader and tab order. It
// is always in the DOM and only fades in, so `toBeVisible()` passes even with a broken hover rule
// and these assert the opacity directly.
test.describe('reorder hover handle', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	/** Signed distance from the handle's center to the center of `anchor`'s box, in px. */
	async function gripOffset(host: import('@playwright/test').Locator, anchor: string) {
		return host.evaluate((el, sel) => {
			const grip = el.querySelector(':scope > .block-drag-handle .grip')!.getBoundingClientRect();
			const target = (el.querySelector(sel) ?? el).getBoundingClientRect();
			return grip.top + grip.height / 2 - (target.top + target.height / 2);
		}, anchor);
	}

	test('top-level block: handle is hidden, reveals on hover, and is aria-hidden', async () => {
		await editor.loadContent('- one\n\n```js\nplain code\n```\n');
		const top = editor.page.locator('.block-host[data-block-kind="fencedCode"]').last();
		const handle = top.locator('.block-drag-handle');

		await expect(handle).toHaveAttribute('aria-hidden', 'true');
		await expect(handle).toHaveCSS('opacity', '0');
		await top.hover();
		await expect(handle).toHaveCSS('opacity', '1');
	});

	// If the margin between block and handle is outside the hover region, the handle hides mid-move
	// and, with `pointer-events: none`, can never catch the pointer.
	test('the revealed handle stays reachable as the pointer moves onto it', async ({ page }) => {
		await editor.loadContent('```js\nplain code here\n```\n\nsecond block\n');
		const top = page.locator('.block-host[data-block-kind="fencedCode"]').last();
		const handle = top.locator('.block-drag-handle');

		await top.hover();
		await expect(handle).toHaveCSS('opacity', '1');

		const box = (await handle.boundingBox())!;
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;
		const blockBox = (await top.boundingBox())!;

		// Start over the block body, then glide left onto the handle, without lifting.
		await page.mouse.move(blockBox.x + 100, cy);
		await page.mouse.move(cx, cy, { steps: 15 });

		await expect(handle).toHaveCSS('opacity', '1');
		const hitsHandle = await page.evaluate(
			([x, y]) => !!document.elementFromPoint(x, y)?.closest('.block-drag-handle'),
			[cx, cy]
		);
		expect(hitsHandle, 'pointer over the handle must resolve to the handle (hittable)').toBe(true);
	});

	// On an unindented top-level block the only left margin is the editor's own padding, so the
	// handle must fit inside it rather than poke behind the border that overflow-x:auto clips.
	test('an unindented top-level handle is not clipped behind the editor border', async ({
		page
	}) => {
		await editor.loadContent('```js\nplain code here\n```\n\nsecond block\n');
		const top = page.locator('.block-host[data-block-kind="fencedCode"]').last();
		const handle = top.locator('.block-drag-handle');

		await top.hover();
		await expect(handle).toHaveCSS('opacity', '1');

		const innerLeft = await page.evaluate(() => {
			const ed = document.querySelector('.editor') as HTMLElement;
			return ed.getBoundingClientRect().left + ed.clientLeft; // just inside the border
		});
		const box = (await handle.boundingBox())!;
		expect(box.x, 'handle left edge must sit inside the editor border').toBeGreaterThanOrEqual(
			innerLeft
		);
	});

	// The handle's hit area must span the block's full height, or approaching a tall block at
	// mid-height hides the handle and strands the pointer.
	test('a tall block handle is reachable when approached at mid-height', async ({ page }) => {
		await editor.loadContent('```js\nline one\nline two\nline three\nline four\n```\n\ntail\n');
		const code = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		const handle = code.locator('.block-drag-handle');

		await code.hover();
		await expect(handle).toHaveCSS('opacity', '1');

		const cb = (await code.boundingBox())!;
		const midY = cb.y + cb.height / 2;
		const gutterX = cb.x - 10; // inside the left gutter, beside the block's middle

		await page.mouse.move(cb.x + 80, midY);
		await page.mouse.move(gutterX, midY, { steps: 12 });

		await expect(handle).toHaveCSS('opacity', '1');
		const hits = await page.evaluate(
			([x, y]) => !!document.elementFromPoint(x, y)?.closest('.block-drag-handle'),
			[gutterX, midY]
		);
		expect(hits, 'handle must be hittable in the gutter at mid-height').toBe(true);
	});

	// The handle sits at the card's own first line height, not at its first line of text: a card
	// pads above that text, so a handle level with the first code line hangs below its shoulder.
	test('the drag handle sits in the top band of a code card, above its first line', async ({
		page
	}) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('```js\nfirst line\nsecond line\n```\n\ntail\n');
		const code = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await code.hover();
		await expect(code.locator('.block-drag-handle')).toHaveCSS('opacity', '1');

		const firstLineTop = (await textRunRect(page, 'first', { path: [0] })).top;
		const seat = await code.evaluate((host, lineTop) => {
			const grip = host.querySelector('.grip')!.getBoundingClientRect();
			const card = host.getBoundingClientRect();
			const centre = grip.top + grip.height / 2;
			const line = parseFloat(getComputedStyle(host).lineHeight) || 20;
			return { fromCardTop: centre - card.top, aboveFirstLine: lineTop - centre, line };
		}, firstLineTop);
		expect(seat.fromCardTop, 'inside the card, not on its edge').toBeGreaterThan(4);
		expect(seat.fromCardTop, 'within the first line-height of the card').toBeLessThanOrEqual(
			seat.line
		);
		expect(seat.aboveFirstLine, 'above the first code line').toBeGreaterThan(0);
	});

	// A one-line block centers on its row, checkbox or bullet alike: level with the row is where
	// the eye puts it, and the checkbox sits a little below that center.
	test('the drag handle centres on a one-line list row', async ({ page }) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('- [ ] open task\n- plain bullet\n\ntail\n');
		for (const text of ['open task', 'plain bullet']) {
			const item = page.locator('.list-item-block', { hasText: text }).last();
			await item.hover();
			await expect(item.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
			const delta = await gripOffset(item, ':scope');
			expect(Math.abs(delta), `${text}: off the row centre by ${delta}px`).toBeLessThanOrEqual(2);
		}
	});

	test('the drag handle centres on a divider', async ({ page }) => {
		await editor.loadContent('# head\n\n---\n\ntail\n');
		const hr = page.locator('.block-host[data-block-kind="thematicBreak"]').first();
		await hr.hover();
		await expect(hr.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
		const delta = await gripOffset(hr, '.thematic-break-rule');
		expect(Math.abs(delta), `off the rule centre by ${delta}px`).toBeLessThanOrEqual(2);
	});

	// The handle is reachable without first hovering the block it belongs to: one you can only
	// reach by crossing the block is a flyout hanging off it.
	test('approaching the drag handle through the gutter alone reveals it and hits it', async ({
		page
	}) => {
		await editor.loadContent('```js\nfirst line\nsecond line\nthird line\n```\n\ntail\n');
		const card = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		const handle = card.locator('.block-drag-handle');
		const box = (await card.boundingBox())!;

		// Start well clear of the block, then come in sideways through the gutter only.
		await page.mouse.move(box.x + box.width / 2, box.y - 60);
		await expect(handle).toHaveCSS('opacity', '0');
		await page.mouse.move(box.x - 12, box.y + 14, { steps: 10 });

		await expect(handle).toHaveCSS('opacity', '1');
		const hits = await card.evaluate((host) => {
			const glyph = host.querySelector('.block-drag-handle svg')!.getBoundingClientRect();
			const el = document.elementFromPoint(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
			return !!el?.closest('.block-drag-handle');
		});
		expect(hits, 'the glyph must be the hit target, not the block behind it').toBe(true);
	});

	test('the drag handle clears the block content by a few px', async ({ page }) => {
		await editor.loadContent('```js\ncode\n```\n');
		const card = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await card.hover();
		const gap = await card.evaluate((host) => {
			const glyph = host.querySelector('.block-drag-handle svg')!.getBoundingClientRect();
			return host.getBoundingClientRect().left - glyph.right;
		});
		expect(gap, 'the glyph must not touch the content').toBeGreaterThanOrEqual(3);
	});

	// A picture has no text line to sit on, and its own top edge puts the handle in the corner.
	test('the drag handle on an image paragraph sits a line into the picture, not on its edge', async ({
		page
	}) => {
		await editor.loadContent('# head\n\n![cat|300](/test-fixtures/sample.png)\n');
		const host = page.locator('.block-host[data-block-path="[1]"]');
		// The position is measured, so the picture must have laid out before the hover reads it.
		await expect
			.poll(() => host.locator('img').evaluate((img) => img.getBoundingClientRect().height))
			.toBeGreaterThan(40);
		await host.hover();
		await expect(host.locator('.block-drag-handle')).toHaveCSS('opacity', '1');

		const inset = await host.evaluate((el) => {
			const grip = el.querySelector('.grip')!.getBoundingClientRect();
			const img = el.querySelector('img')!.getBoundingClientRect();
			return grip.top + grip.height / 2 - img.top;
		});
		expect(inset, 'drag handle must sit inside the picture').toBeGreaterThan(4);
		expect(inset, 'and within its first line, not adrift down it').toBeLessThan(40);
	});

	// A handle on the list itself would land in the gutter on top of the first item's and, being
	// its own hit target, take the pointer: aiming at row one would move the whole list.
	test('the list shell carries no handle of its own, so row one owns its gutter', async ({
		page
	}) => {
		await editor.loadContent('- [x] write an editor\n- [x] open source it\n- [ ] third\n');
		await expect(
			page.locator('.block-host[data-block-kind="list"] > .block-drag-handle')
		).toHaveCount(0);

		// Come in from far away, straight onto the first row's glyph: that row lights, alone.
		const rows = page.locator('.list-item-block > .block-drag-handle');
		await page.mouse.move(450, 60);
		const glyph = await rows.first().locator('svg').boundingBox();
		await page.mouse.move(glyph!.x + glyph!.width / 2, glyph!.y + glyph!.height / 2, { steps: 8 });
		await expect(rows.nth(0)).toHaveCSS('opacity', '1');
		await expect(rows.nth(1)).toHaveCSS('opacity', '0');
		await expect(rows.nth(2)).toHaveCSS('opacity', '0');
	});

	test('nested hover reveals only the innermost unit, not the ancestor handle', async () => {
		await editor.loadContent('- outer\n  - inner item\n  - inner two\n- outer two\n');
		const inner = editor.page.locator('.list-item-block', { hasText: 'inner item' }).last();
		const outerOwnHandle = editor.page
			.locator('.list-item-block', { hasText: 'outer' })
			.first()
			.locator(':scope > .block-drag-handle');

		await inner.hover();
		await expect(inner.locator(':scope > .block-drag-handle')).toHaveCSS('opacity', '1');
		await expect(outerOwnHandle).toHaveCSS('opacity', '0'); // no staircase
	});

	test('axe baseline stays green with handles rendered', async ({ page }) => {
		await editor.loadContent('- one\n- two\n\nplain\n\n> quoted\n');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'reorder-handle');
	});
});

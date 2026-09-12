import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';

// The handle is a mouse-only affordance: one per reorder unit that is an OBJECT (code, table,
// picture, equation, list item, divider) rather than prose, kept out of the SR/tab flow. Reveal is
// opacity-only and the handle is always in the DOM, so toBeVisible() would pass even with a broken
// hover rule — assert the opacity directly.
test.describe('reorder hover handle', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	/** Signed distance from the grip's centre to the centre of `anchor`'s box, in px. */
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

	// Reachability: the earlier tests hover the block CENTER and pass even when the handle is
	// unreachable. If the margin between block and handle is not in the hover region, the handle
	// hides mid-move and, being pointer-events:none once hidden, can never re-catch the pointer.
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

		// Start over the block body, then glide LEFT onto the handle, continuously.
		await page.mouse.move(blockBox.x + 100, cy);
		await page.mouse.move(cx, cy, { steps: 15 });

		await expect(handle).toHaveCSS('opacity', '1');
		const hitsHandle = await page.evaluate(
			([x, y]) => !!document.elementFromPoint(x, y)?.closest('.block-drag-handle'),
			[cx, cy]
		);
		expect(hitsHandle, 'pointer over the handle must resolve TO the handle (hittable)').toBe(true);
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

	// The handle hit area must span the block's full height: approaching a tall block at mid-height
	// otherwise leaves the block, hides the handle, and strands it — the axis the earlier test does
	// not isolate.
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

	// The seat is the card's own first line-height, NOT its first line of text: a card pads above
	// that text, and a grip level with the first code line hangs below the card's shoulder.
	test('the handle grip sits in the top band of a code card, above its first line', async ({
		page
	}) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('```js\nfirst line\nsecond line\n```\n\ntail\n');
		const code = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await code.hover();
		await expect(code.locator('.block-drag-handle')).toHaveCSS('opacity', '1');

		const seat = await code.evaluate((host) => {
			const grip = host.querySelector('.grip')!.getBoundingClientRect();
			const card = host.getBoundingClientRect();
			const body = host.querySelector('.code-block')!;
			const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
			let firstLineTop = NaN;
			for (let t = tw.nextNode(); t; t = tw.nextNode()) {
				if (!t.textContent?.includes('first')) continue;
				const range = document.createRange();
				range.selectNodeContents(t);
				firstLineTop = range.getClientRects()[0].top;
				break;
			}
			const centre = grip.top + grip.height / 2;
			const line = parseFloat(getComputedStyle(host).lineHeight) || 20;
			return { fromCardTop: centre - card.top, aboveFirstLine: firstLineTop - centre, line };
		});
		expect(seat.fromCardTop, 'inside the card, not on its edge').toBeGreaterThan(4);
		expect(seat.fromCardTop, 'within the first line-height of the card').toBeLessThanOrEqual(
			seat.line
		);
		expect(seat.aboveFirstLine, 'above the first code line').toBeGreaterThan(0);
	});

	// A one-line block centres on its ROW, checkbox or bullet alike: level with the row is where
	// the eye puts it, and the checkbox sits a little below that centre.
	test('the handle grip centres on a one-line list row', async ({ page }) => {
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

	test('the handle grip centres on a divider', async ({ page }) => {
		await editor.loadContent('# head\n\n---\n\ntail\n');
		const hr = page.locator('.block-host[data-block-kind="thematicBreak"]').first();
		await hr.hover();
		await expect(hr.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
		const delta = await gripOffset(hr, '.thematic-break-rule');
		expect(Math.abs(delta), `off the rule centre by ${delta}px`).toBeLessThanOrEqual(2);
	});

	test('the grip is the lucide grip-vertical glyph, six dots', async ({ page }) => {
		await editor.loadContent('```js\ncode\n```\n');
		const card = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await expect(card.locator('.block-drag-handle .grip svg path')).toHaveCount(6);
	});

	// The grip is reachable WITHOUT first hovering the block it belongs to: a grip you can only
	// reach by traversing the block is a flyout hanging off it.
	test('approaching the grip through the gutter alone reveals it and hits it', async ({ page }) => {
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

	test('the grip clears the block content by a few px', async ({ page }) => {
		await editor.loadContent('```js\ncode\n```\n');
		const card = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await card.hover();
		const gap = await card.evaluate((host) => {
			const glyph = host.querySelector('.block-drag-handle svg')!.getBoundingClientRect();
			return host.getBoundingClientRect().left - glyph.right;
		});
		expect(gap, 'the glyph must not touch the content').toBeGreaterThanOrEqual(3);
	});

	// A picture is not prose: the paragraph holding it is the thing a reader reaches to move.
	test('an image-only paragraph carries a handle; an image beside words does not', async () => {
		await editor.loadContent(
			'![cat|200](/test-fixtures/sample.png)\n\n![cat|200](/test-fixtures/sample.png) beside words\n'
		);
		const imageOnly = editor.page.locator('.block-host[data-block-path="[0]"]');
		const mixed = editor.page.locator('.block-host[data-block-path="[1]"]');
		await expect(imageOnly.locator(':scope > .block-drag-handle')).toHaveCount(1);
		await expect(mixed.locator(':scope > .block-drag-handle')).toHaveCount(0);
	});

	// A picture has no text line to sit on, and its own top edge puts the grip in the corner.
	test('the grip on an image paragraph sits a line into the picture, not on its edge', async ({
		page
	}) => {
		await editor.loadContent('# head\n\n![cat|300](/test-fixtures/sample.png)\n');
		const host = page.locator('.block-host[data-block-path="[1]"]');
		// The seat is measured, so the picture must have laid out before the hover reads it.
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
		expect(inset, 'grip must sit inside the picture').toBeGreaterThan(4);
		expect(inset, 'and within its first line, not adrift down it').toBeLessThan(40);
	});

	test('a paragraph is a background block: no handle, but still a reorder unit', async () => {
		await editor.loadContent('# head\n\nplain\n\n- one\n');
		const para = editor.page.locator('.block-host[data-block-kind="paragraph"]').first();
		await para.hover();
		await expect(para.locator(':scope > .block-drag-handle')).toHaveCount(0);
		await expect(para).toHaveClass(/reorder-host/);
	});

	test('list item is a reorder unit; its inner paragraph is not (one handle in subtree)', async () => {
		await editor.loadContent('- one\n\nplain\n');
		const item = editor.page.locator('.list-item-block', { hasText: 'one' });
		await item.hover();
		await expect(item.locator('.block-drag-handle')).toHaveCount(1);
		await expect(item.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
	});

	// The shell's grip landed in the gutter on top of the first item's and, being its own hit
	// target, took the pointer: aiming at row one lit a grip that moved the whole list.
	test('the list shell carries no handle of its own, so row one owns its gutter', async ({
		page
	}) => {
		await editor.loadContent('- [x] write an editor\n- [x] open source it\n- [ ] third\n');
		await expect(
			page.locator('.block-host[data-block-kind="list"] > .block-drag-handle')
		).toHaveCount(0);

		// Come in from far away, straight onto the FIRST row's glyph: that row lights, alone.
		const rows = page.locator('.list-item-block > .block-drag-handle');
		await page.mouse.move(450, 60);
		const glyph = await rows.first().locator('svg').boundingBox();
		await page.mouse.move(glyph!.x + glyph!.width / 2, glyph!.y + glyph!.height / 2, { steps: 8 });
		await expect(rows.nth(0)).toHaveCSS('opacity', '1');
		await expect(rows.nth(1)).toHaveCSS('opacity', '0');
		await expect(rows.nth(2)).toHaveCSS('opacity', '0');
	});

	// Prose carries no grip, and a quote is prose holding prose: neither the quote nor the
	// paragraphs inside it get one.
	test('a blockquote and its prose children carry no handle', async () => {
		await editor.loadContent('> a\n>\n> b\n');
		await editor.page.locator('.blockquote-block').hover();
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});

	test('a note card carries no handle either', async () => {
		await editor.loadContent('> [!NOTE]\n> body text\n');
		await editor.page.locator('.block-host').first().hover();
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});

	test('nested hover reveals only the innermost unit, not the ancestor handle', async () => {
		await editor.loadContent('- outer\n  - inner item\n');
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
		await editor.loadContent('- one\n\nplain\n\n> quoted\n');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'reorder-handle');
	});

	// Dragging a picture is the only pointer road to move one, so its grip is not an opt-in.
	test('an image paragraph keeps its handle with blockDragHandles=false', async () => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent('![cat|200](/test-fixtures/sample.png)\n\nplain\n');
		await expect(
			editor.page.locator('.block-host[data-block-path="[0]"] > .block-drag-handle')
		).toHaveCount(1);
		await expect(
			editor.page.locator('.block-host[data-block-path="[1]"] > .block-drag-handle')
		).toHaveCount(0);
	});

	test('reading mode shows no handle, not even on an image paragraph', async () => {
		await editor.goto('?presentationMode=reading');
		await editor.loadContent('![cat|200](/test-fixtures/sample.png)\n\n# head\n');
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});

	test('blockDragHandles=false renders no handle, even on hover', async () => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent('- one\n\nplain\n');
		const top = editor.page.locator('.block-host', { hasText: 'plain' }).last();
		await top.hover();
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});
});

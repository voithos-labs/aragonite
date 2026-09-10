import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';

// The handle is a mouse-only affordance: one per reorder unit that is not a paragraph (the page's
// background), revealed by a pure-CSS host hover rule and kept out of the SR/tab flow. Reveal is
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
		await editor.loadContent('- one\n\n# plain\n');
		const top = editor.page.locator('.block-host', { hasText: 'plain' }).last();
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
		await editor.loadContent('# plain heading here\n\nsecond block\n');
		const top = page.locator('.block-host', { hasText: 'plain heading' }).last();
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
		await editor.loadContent('# plain heading here\n\nsecond block\n');
		const top = page.locator('.block-host', { hasText: 'plain heading' }).last();
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

	// A heading's line is taller than the host's own line-height, so a grip placed by the
	// host's `lh` sits above the text; the placement is measured on hover instead.
	test('the handle grip centres on the first line of a heading', async ({ page }) => {
		await editor.loadContent('# A single line heading here\n\ntail\n');
		const head = page.locator('.block-host[data-block-kind="heading"]').first();
		await head.hover();
		await expect(head.locator('.block-drag-handle')).toHaveCSS('opacity', '1');

		const delta = await head.evaluate((host) => {
			const grip = host.querySelector('.grip')!.getBoundingClientRect();
			const ce = host.querySelector('[contenteditable]') ?? host;
			const tw = document.createTreeWalker(ce, NodeFilter.SHOW_TEXT);
			for (let t = tw.nextNode(); t; t = tw.nextNode()) {
				if (!t.textContent?.trim()) continue;
				const range = document.createRange();
				range.selectNodeContents(t);
				const line = [...range.getClientRects()].find((r) => r.height > 0);
				if (line) return grip.top + grip.height / 2 - (line.top + line.height / 2);
			}
			return NaN;
		});
		expect(
			Math.abs(delta),
			`grip should align with first-line center (off by ${delta}px)`
		).toBeLessThanOrEqual(2);
	});

	// The card pads above its first line; the grip belongs beside that line, not the card edge.
	// Live mode, where the fence is hidden: in source it is the first line and the grip's seat.
	test('the handle grip centres on the first line of a code block', async ({ page }) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('```js\nfirst line\nsecond line\n```\n\ntail\n');
		const code = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await code.hover();
		await expect(code.locator('.block-drag-handle')).toHaveCSS('opacity', '1');

		const delta = await code.evaluate((host) => {
			const grip = host.querySelector('.grip')!.getBoundingClientRect();
			const body = host.querySelector('.code-block')!;
			const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
			for (let t = tw.nextNode(); t; t = tw.nextNode()) {
				if (!t.textContent?.includes('first')) continue;
				const range = document.createRange();
				range.selectNodeContents(t);
				const line = range.getClientRects()[0];
				return grip.top + grip.height / 2 - (line.top + line.height / 2);
			}
			return NaN;
		});
		expect(
			Math.abs(delta),
			`grip should align with the first code line (off by ${delta}px)`
		).toBeLessThanOrEqual(2);
	});

	test('the handle grip centres on a task item checkbox', async ({ page }) => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('- [ ] open task\n\ntail\n');
		const item = page.locator('.list-item-block').first();
		await item.hover();
		await expect(item.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
		const delta = await gripOffset(item, '.task-checkbox');
		expect(Math.abs(delta), `off the checkbox centre by ${delta}px`).toBeLessThanOrEqual(2);
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
		await editor.loadContent('# head\n');
		const head = page.locator('.block-host[data-block-kind="heading"]').first();
		await expect(head.locator('.block-drag-handle .grip svg path')).toHaveCount(6);
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

	test('blockquote child reveals its own handle on hover', async () => {
		await editor.loadContent('> # a\n>\n> # b\n');
		const child = editor.page.locator('.blockquote-block .block-host', { hasText: 'b' });
		const handle = child.locator('.block-drag-handle');
		await expect(handle).toHaveCSS('opacity', '0');
		await child.hover();
		await expect(handle).toHaveCSS('opacity', '1');
	});

	test('nested hover reveals only the innermost unit, not the ancestor handle', async () => {
		await editor.loadContent('> # a\n>\n> # b\n');
		const bqOwnHandle = editor.page.locator(
			'.block-host[data-block-kind="blockquote"] > .block-drag-handle'
		);
		const child = editor.page.locator('.blockquote-block .block-host', { hasText: 'b' });
		const childHandle = child.locator('.block-drag-handle');

		await child.hover();
		await expect(childHandle).toHaveCSS('opacity', '1'); // innermost unit reveals
		await expect(bqOwnHandle).toHaveCSS('opacity', '0'); // ancestor stays hidden — no staircase
	});

	// A gripless child is no handle host, so the hover falls through to the container's grip.
	test('hovering a quoted paragraph reveals the blockquote handle', async () => {
		await editor.loadContent('> a\n>\n> b\n');
		const bqOwnHandle = editor.page.locator(
			'.block-host[data-block-kind="blockquote"] > .block-drag-handle'
		);
		const child = editor.page.locator('.blockquote-block .block-host', { hasText: 'b' });
		await expect(child.locator(':scope > .block-drag-handle')).toHaveCount(0);
		await child.hover();
		await expect(bqOwnHandle).toHaveCSS('opacity', '1');
	});

	test('axe baseline stays green with handles rendered', async ({ page }) => {
		await editor.loadContent('- one\n\nplain\n\n> quoted\n');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'reorder-handle');
	});

	test('blockDragHandles=false renders no handle, even on hover', async () => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent('- one\n\nplain\n');
		const top = editor.page.locator('.block-host', { hasText: 'plain' }).last();
		await top.hover();
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});
});

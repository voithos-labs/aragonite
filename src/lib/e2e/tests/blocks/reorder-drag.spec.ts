import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pollAutoscrollPast } from '../../autoscroll';

// Drop index is direction-dependent (removing the dragged block shifts later indices), so DOWN, UP,
// and a within-container drag are all covered to catch an off-by-one. The top-level blocks are
// code cards: prose carries no handle to press (`components/drag-handle.ts`).
test.describe('drag to reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The handle only mounts on hover, so callers must hover the block first.
	async function handleCenter(
		srcSelector: string,
		srcText: string
	): Promise<{ x: number; y: number }> {
		const src = editor.page.locator(srcSelector, { hasText: srcText }).first();
		await src.hover();
		const hb = await src.locator('.block-drag-handle').first().boundingBox();
		if (!hb) throw new Error('missing handle bounding box');
		return { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
	}

	async function dragHandle(
		srcSelector: string,
		srcText: string,
		dstSelector: string,
		dstText: string,
		below: boolean
	): Promise<void> {
		const handle = await handleCenter(srcSelector, srcText);
		const db = await editor.page.locator(dstSelector, { hasText: dstText }).first().boundingBox();
		if (!db) throw new Error('missing bounding box');
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(db.x + db.width / 2, below ? db.y + db.height - 2 : db.y + 2, {
			steps: 14
		});
		await editor.page.mouse.up();
	}

	test('drag a top-level block DOWN past two siblings', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		await dragHandle('.block-host', 'A', '.block-host', 'C', true);
		await editor.bridge.waitForSourceMatches(/B[\s\S]*C[\s\S]*A/);
	});

	test('drag a top-level block UP to the top', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		await dragHandle('.block-host', 'C', '.block-host', 'A', false);
		await editor.bridge.waitForSourceMatches(/C[\s\S]*A[\s\S]*B/);
	});

	test('drag a list item within its list', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await dragHandle('.list-item-block', 'one', '.list-item-block', 'three', true);
		await editor.bridge.waitForSourceMatches(/- two[\s\S]*- three[\s\S]*- one/);
	});

	// A nested drag reorders only within its container, so the container is marked for the drag's
	// duration to read as "reorder within this list" rather than "broken".
	test('a nested drag marks its scope container and clears it on drop', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await expect(editor.page.locator('.reorder-scope')).toHaveCount(0);

		const handle = await handleCenter('.list-item-block', 'two');
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(handle.x + 30, handle.y - 24, { steps: 6 });

		await expect(editor.page.locator('.list-block.reorder-scope')).toHaveCount(1);

		await editor.page.mouse.up();
		await expect(editor.page.locator('.reorder-scope')).toHaveCount(0);
	});

	// A top-level drag's scope IS the document — there is no container to mark, so
	// the cue must not appear (marking the whole editor would be noise).
	test('a top-level drag marks no scope container', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		const handle = await handleCenter('.block-host', 'B');
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(handle.x + 30, handle.y - 24, { steps: 6 });

		await expect(editor.page.locator('.reorder-scope')).toHaveCount(0);

		await editor.page.mouse.up();
	});

	test('press and release without moving is a no-op (and pushes no undo entry)', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		const before = await editor.bridge.getSource();

		const handle = await handleCenter('.block-host', 'B');
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.up();

		// A mouse gesture, and then an undo chord pressed with focus outside every surface:
		// neither produces a keydown verdict.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);

		// A drag that committed nothing must leave the undo stack untouched.
		await editor.undo();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Escape cancels an in-progress drag', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		const before = await editor.bridge.getSource();

		const handle = await handleCenter('.block-host', 'A');
		const cb = await editor.page.locator('.block-host', { hasText: 'C' }).first().boundingBox();
		if (!cb) throw new Error('missing bounding box');
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height - 2, { steps: 14 });
		await editor.page.keyboard.press('Escape');
		await editor.page.mouse.up();

		// The drag session owns Escape through a document listener, not a block surface.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	// Focusing what was dropped opens whatever a caret opens there — an equation reveals its
	// source, so a dragged one came back in edit mode. The latex kind lives on the plugins
	// route, so the contract is pinned here on the block this route has.
	test('a drop focuses nothing it dropped', async ({ page }) => {
		await editor.loadContent('```js\nfirst\n```\n\n```js\nsecond\n```\n\ntail\n');
		const first = page.locator('.block-host[data-block-kind="fencedCode"]').first();
		await first.hover();
		const hb = (await first.locator(':scope > .block-drag-handle svg').boundingBox())!;
		const dst = (await page
			.locator('.block-host[data-block-kind="fencedCode"]')
			.last()
			.boundingBox())!;

		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height - 2, { steps: 12 });
		await page.mouse.up();

		await editor.bridge.waitForSourceMatches(/second[\s\S]*first/);
		const focusedInsideABlock = await page.evaluate(
			() => !!document.activeElement?.closest('.block-host')
		);
		expect(focusedInsideABlock, 'a drop must not focus what it dropped').toBe(false);
	});

	test('the ghost names a table rather than sampling its cells', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntail\n');
		const table = page.locator('.block-host[data-block-kind="table"]').first();
		await table.hover();
		const hb = (await table.locator(':scope > .block-drag-handle svg').boundingBox())!;
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + 120, hb.y + 60, { steps: 6 });

		await expect(page.locator('.reorder-ghost')).toHaveText('Table · 2 × 2');
		await page.keyboard.press('Escape');
		await page.mouse.up();
	});

	// Trivia is positional, so a block dropped into a slot whose separator was empty (a heading
	// interrupting the paragraph above it) lands flush against that paragraph, whose next lines
	// the table's rows then are.
	test('a table dropped flush under a paragraph stays a table', async ({ page }) => {
		await editor.loadContent('Intro\n# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const table = page.locator('.block-host[data-block-kind="table"]').first();
		await table.hover();
		const hb = (await table.locator(':scope > .block-drag-handle svg').boundingBox())!;
		const heading = (await page
			.locator('.block-host[data-block-kind="heading"]')
			.first()
			.boundingBox())!;

		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(heading.x + heading.width / 2, heading.y + 2, { steps: 12 });
		await page.mouse.up();

		await editor.bridge.waitForSourceEquals(
			'Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n# Heading\n'
		);
		expect(await editor.bridge.getBlockKind(1)).toBe('table');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('dragging the handle starts no text selection', async () => {
		await editor.loadContent('```\nA\n```\n\n```\nB\n```\n\n```\nC\n```\n');
		await dragHandle('.block-host', 'A', '.block-host', 'C', true);

		const selected = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected).toBe('');
	});

	test('drag toward the bottom edge autoscrolls past virtualized blocks and drops', async () => {
		// Far more blocks than fit in the viewport, so blocks below the fold are virtualized
		// out — the drop target is unreachable without autoscroll. Code cards: prose carries no
		// handle to press.
		await editor.loadContent(
			Array.from({ length: 150 }, (_, i) => '```\npara ' + i + '\n```').join('\n\n') + '\n'
		);
		const editorEl = editor.page.locator('.editor');

		const handle = await handleCenter('.block-host', 'para 0');
		const edgeBox = await editorEl.boundingBox();
		if (!edgeBox) throw new Error('editor not laid out');
		// A few px above the scroll container's bottom — inside the autoscroll
		// threshold band so the held pointer drives the rAF loop downward.
		const edgeX = edgeBox.x + edgeBox.width / 2;
		const edgeY = edgeBox.y + edgeBox.height - 5;

		const startScroll = await editorEl.evaluate((el) => el.scrollTop);
		await editor.page.mouse.move(handle.x, handle.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(edgeX, edgeY, { steps: 8 });

		// Poll scrollTop past a full viewport height so the deep region mounts.
		await pollAutoscrollPast(
			editor.page,
			{ x: edgeX, y: edgeY },
			() => editorEl.evaluate((el) => el.scrollTop),
			startScroll + edgeBox.height,
			5000
		);

		// Move out of the threshold band so autoscroll halts and geometry stabilizes: a boundingBox
		// read while the loop still scrolls is stale by the time of the drop.
		const drop = await editor.page.evaluate(() => {
			const root = document.querySelector('.editor') as HTMLElement;
			const rootRect = root.getBoundingClientRect();
			// A mounted top-level block sitting in the upper-middle of the viewport.
			for (const host of Array.from(root.querySelectorAll('.block-host'))) {
				if (host.getAttribute('data-block-path')?.includes(',')) continue;
				const r = host.getBoundingClientRect();
				if (r.top > rootRect.top + rootRect.height * 0.25 && r.bottom < rootRect.bottom - 40) {
					return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: host.textContent ?? '' };
				}
			}
			return null;
		});
		if (!drop) throw new Error('no stable mid-viewport drop target after autoscroll');
		expect(drop.text).not.toContain('para 0');

		await editor.page.mouse.move(drop.x, drop.y, { steps: 6 });
		await editor.page.mouse.up();

		// para 0 committed a move into the off-window region: it now follows some
		// later paragraph in the source. Exact landing index is irrelevant.
		await editor.bridge.waitForSourceMatches(/para 1[\s\S]*\npara 0\n```/);
		// And the document is intact — no block dropped or duplicated.
		expect(await editor.bridge.getBlockCount()).toBe(150);
	});
});

import { test } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Real pointer drag from the hover handle. Drop index is direction-dependent
// (removing the dragged block shifts later indices), so both DOWN and UP and a
// within-container drag are covered to catch an off-by-one.
test.describe('drag to reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function dragHandle(
		srcSelector: string,
		srcText: string,
		dstSelector: string,
		dstText: string,
		below: boolean
	): Promise<void> {
		const src = editor.page.locator(srcSelector, { hasText: srcText }).first();
		await src.hover();
		const hb = await src.locator('.block-drag-handle').first().boundingBox();
		const db = await editor.page.locator(dstSelector, { hasText: dstText }).first().boundingBox();
		if (!hb || !db) throw new Error('missing bounding box');
		await editor.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await editor.page.mouse.down();
		await editor.page.mouse.move(db.x + db.width / 2, below ? db.y + db.height - 2 : db.y + 2, {
			steps: 14
		});
		await editor.page.mouse.up();
	}

	test('drag a top-level block DOWN past two siblings', async () => {
		await editor.loadContent('A\n\nB\n\nC\n');
		await dragHandle('.block-host', 'A', '.block-host', 'C', true);
		await editor.bridge.waitForSourceMatches(/B[\s\S]*C[\s\S]*A/);
	});

	test('drag a top-level block UP to the top', async () => {
		await editor.loadContent('A\n\nB\n\nC\n');
		await dragHandle('.block-host', 'C', '.block-host', 'A', false);
		await editor.bridge.waitForSourceMatches(/C[\s\S]*A[\s\S]*B/);
	});

	test('drag a list item within its list', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await dragHandle('.list-item-block', 'one', '.list-item-block', 'three', true);
		await editor.bridge.waitForSourceMatches(/- two[\s\S]*- three[\s\S]*- one/);
	});
});

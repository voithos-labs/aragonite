import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Decorations, run in the default gate. plugin-ops already runs the decoration machinery
// under these checks; this drives the interaction with them instead: the caret, deletes and
// typing around a decoration, and a block's badge, none of which had a gesture before. Every
// gesture leaves the bytes as they were, so the end state still matches. The decoded-entity
// widget runs in the same session, beside a decoration that shows a character of its own.

const DECORATION_DOC =
	'Alpha lead with a [>hidden gem<] fold inline.\n\n' +
	'A WIDGET anchor sits mid sentence here.\n\n' +
	'BADGE marks this whole block below.\n\n' +
	'Tail line for entity and neutral edits.\n';

test.describe('decoration-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// `?seed=sim` installs both decoration sources; `loadContent` replaces the seed's
		// empty document with DECORATION_DOC, whose markers (`[>…<]`, `WIDGET`, `BADGE`) are
		// what those sources match.
		await editor.gotoPlugins('sim');
	});

	test('widget caret/delete/typing + block-badge reorder + entity widget stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(DECORATION_DOC);
		await editor.waitForRenderFlush();
		const loaded = await editor.bridge.getSource();

		// `loadContent` fires no edit event and decoration sources run on each edit, so an edit
		// that changes nothing is what gets them running before the gestures.
		await editor.focusBlockEnd(3);
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceWith((s, prev) => s !== prev, loaded);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(loaded);
		await editor.waitForRenderFlush();

		// The decorations are now drawn at the positions their text implies, before any gesture.
		await expect(page.locator("[data-block-path='[0]'] [data-decoration-island]")).toHaveCount(1);
		await expect(page.locator("[data-block-path='[1]'] [data-decoration-island]")).toHaveCount(1);
		await expect(page.locator("[data-block-path='[2]'].sim-badged-block")).toHaveCount(1);

		const ctx = await makeSimContext(page, editor, 'decoration-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		await assertCheckpoint(ctx, 'loaded');

		// ── Replace decoration (block 0): walk it, delete from each edge, type beside it ──
		await g.walkAcrossIsland(0);
		await assertCheckpoint(ctx, 'replace-walk');

		await g.edgeDeleteReplaceIsland(0, 'Backspace');
		await assertCheckpoint(ctx, 'replace-backspace-delete');

		await g.edgeDeleteReplaceIsland(0, 'Delete');
		await assertCheckpoint(ctx, 'replace-delete-delete');

		await g.typeAdjacentToIsland(0);
		await assertCheckpoint(ctx, 'replace-type-adjacent');

		// ── Widget decoration (block 1): walk through it, backspace through it, type beside ──
		await g.walkAcrossIsland(1);
		await assertCheckpoint(ctx, 'widget-walk');

		await g.backspaceThroughWidgetIsland(1);
		await assertCheckpoint(ctx, 'widget-backspace-through');

		await g.typeAdjacentToIsland(1);
		await assertCheckpoint(ctx, 'widget-type-adjacent');

		// ── Block decoration (block 2): reorder down and back; the badge follows ──
		await g.reorderDecoratedBlock(2);
		await assertCheckpoint(ctx, 'badge-reorder');

		// ── Entity widget (block 3): type mid-sentence, then delete it whole ──
		await g.typeEntityWidget(3, 5, '&copy;');
		expect(await editor.bridge.getSource()).toContain('Tail &copy;line');
		await assertCheckpoint(ctx, 'entity-typed');

		await g.atomicDeleteEntityWidget(3);
		await assertCheckpoint(ctx, 'entity-deleted');

		// Every gesture leaves the bytes as they were, so the document is back to what loaded.
		expect(await editor.bridge.getSource()).toBe(loaded);
	});
});

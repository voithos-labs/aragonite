import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import {
	type SimContext,
	assertCoreOracles,
	assertParseConvergence
} from '../../simulation/invariants';

// Ungated decoration-ops oracle. plugin-ops already runs the decoration ENGINE under the
// corruption oracles; this drives the INTERACTION surface — island caret/delete/typing and
// block-decoration chrome — which had no gesture and was scripted-e2e only. Every gesture
// nets to identity, so end-state equality holds. The decoded-entity atomic widget rides the
// same session as a widget-island sibling carrying its glyph, not its raw.

const DECORATION_DOC =
	'Alpha lead with a [>hidden gem<] fold inline.\n\n' +
	'A WIDGET anchor sits mid sentence here.\n\n' +
	'BADGE marks this whole block below.\n\n' +
	'Tail line for entity and neutral edits.\n';

test.describe('decoration-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// `?seed=sim` installs the standing mark source plus the content-keyed island
		// source; loadContent overrides the seed's (absent) document with DECORATION_DOC,
		// whose sentinels (`[>…<]`, `WIDGET`, `BADGE`) light up the island source.
		await editor.gotoPlugins('sim');
	});

	test('island caret/delete/typing + block-badge reorder + entity widget stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(DECORATION_DOC);
		await editor.waitForRenderFlush();
		const loaded = await editor.bridge.getSource();

		// `loadContent` fires no edit event and decoration sources run on the per-edit pass, so a
		// neutral net-identity edit is what primes the engine before the island gestures.
		await editor.focusBlockEnd(3);
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceWith((s, prev) => s !== prev, loaded);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(loaded);
		await editor.waitForRenderFlush();

		// The decorations now paint at their content-keyed positions before any gesture.
		await expect(page.locator("[data-block-path='[0]'] [data-decoration-island]")).toHaveCount(1);
		await expect(page.locator("[data-block-path='[1]'] [data-decoration-island]")).toHaveCount(1);
		await expect(page.locator("[data-block-path='[2]'].sim-badged-block")).toHaveCount(1);

		const tracker = new ExpectationTracker(loaded);
		const ctx: SimContext = { page, editor, tracker, errors, label: 'decoration-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = async (label: string): Promise<void> => {
			await assertCoreOracles(ctx, label);
			await assertParseConvergence(ctx);
		};
		await checkOracles('loaded');

		// ── Replace island (block 0): walk, two-press delete both edges, type adjacent ──
		await g.walkAcrossIsland(0);
		await checkOracles('replace-walk');

		await g.edgeDeleteReplaceIsland(0, 'Backspace');
		await checkOracles('replace-backspace-delete');

		await g.edgeDeleteReplaceIsland(0, 'Delete');
		await checkOracles('replace-delete-delete');

		await g.typeAdjacentToIsland(0);
		await checkOracles('replace-type-adjacent');

		// ── Widget island (block 1): walk (transparency), backspace-through, type adjacent ──
		await g.walkAcrossIsland(1);
		await checkOracles('widget-walk');

		await g.backspaceThroughWidgetIsland(1);
		await checkOracles('widget-backspace-through');

		await g.typeAdjacentToIsland(1);
		await checkOracles('widget-type-adjacent');

		// ── Block decoration (block 2): reorder down and back; the badge follows ──
		await g.reorderDecoratedBlock(2);
		await checkOracles('badge-reorder');

		// ── Entity widget (block 3): type mid-prose, then atomic-delete whole ──
		await g.typeEntityWidget(3, 5, '&copy;');
		expect(await editor.bridge.getSource()).toContain('Tail &copy;line');
		await checkOracles('entity-typed');

		await g.atomicDeleteEntityWidget(3);
		await checkOracles('entity-deleted');

		// Every gesture nets to identity, so the document returns to the loaded bytes.
		expect(await editor.bridge.getSource()).toBe(loaded);
	});
});

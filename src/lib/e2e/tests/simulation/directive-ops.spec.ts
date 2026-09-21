import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext, topLevelIndexOf } from './helpers';

// The `:::name` syntax, run in the default gate. It covers three shapes (an opaque container,
// a block that cannot merge, and an inline widget) and two paths through the parser: a
// registered name, which resolves to the plugin's own node, and an unregistered one, which
// falls back to the generic kinds. None of it had been run through a long session before.
// `:::callout` and `:::mystery` drive both paths.

const DIRECTIVE_DOC =
	'Lead paragraph.\n\n' +
	// `mystery` has to stay a name no harness plugin takes, since the checks on the generic
	// kinds depend on it; a plugin taking it fails the count check loudly, by design.
	':::mystery\nGeneric body.\n:::\n\n' +
	'Middle paragraph.\n\n' +
	':::callout Note title\nRegistered body.\n:::\n\n' +
	'Tail paragraph.\n';

async function directiveBlockCount(page: Page): Promise<number> {
	return page.locator('.directive-block').count();
}

test.describe('directive-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// `?seed=sim` adds the decoration source (sim-mark-plugin) to the base plugins, so the
		// checks watch decorations run on every edit. `loadContent` replaces the seed's empty
		// document with DIRECTIVE_DOC.
		await editor.gotoPlugins('sim');
	});

	test('insert / edit / reveal / structural ops across container, leaf, and text tiers stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(DIRECTIVE_DOC);
		await editor.waitForRenderFlush();
		// Both paths resolved while parsing: the callout for the registered name, the generic
		// container for the unregistered one.
		await expect(page.locator('.callout-block')).toHaveCount(1);
		await expect(page.locator('.directive-block')).toHaveCount(1);

		const ctx = await makeSimContext(page, editor, 'directive-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// ── Inline: insert a widget, then open it, edit it and commit ─────────────
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.insertTextDirective('abbr', 'HTML');
		await expect(page.locator('.directive-text-widget')).toHaveCount(1);
		await checkOracles('text-inserted');

		// Proves the decoration source is alive: one that quietly stopped would leave this suite
		// green with no decoration coverage at all. It comes after the first edit, not at load,
		// since `loadContent` fires no edit event and nothing is drawn before that commit.
		await expect
			.poll(() => page.locator('.decoration-overlay.sim-standing-mark').count())
			.toBeGreaterThan(0);

		// Step past `:abbr[` (6 chars) into the label, insert an 'X', blur to commit.
		await g.revealEditTextDirective(6, 'X', 2);
		expect(await editor.bridge.getSource()).toContain(':abbr[XHTML]');
		await checkOracles('text-edited');

		// ── One-line form: insert on a new line, edit it, Backspace at its start ────
		await editor.focusBlockEnd((await editor.bridge.getBlockCount()) - 1);
		await g.pressEnter();
		await g.insertLeafDirective('toc', 'info');
		const leafIndex = (await editor.bridge.getBlockCount()) - 1;
		expect(await editor.bridge.getBlockKind(leafIndex)).toBe('directiveLeaf');
		await checkOracles('leaf-inserted');

		await g.editLeafInfo(leafIndex, ' more');
		expect(await editor.bridge.getSource()).toContain('::toc info more');
		await checkOracles('leaf-edited');

		// It cannot merge, so Backspace at its start moves the focus and joins nothing.
		await g.leafBackspaceAtStart(leafIndex);
		await checkOracles('leaf-not-mergeable');

		// ── Container, unregistered: edit the body, then split it ─────────────────
		let tipIndex = await topLevelIndexOf(page, 'directiveContainer');
		await g.editContainerBody([tipIndex, 0], ' extra');
		expect(await editor.bridge.getSource()).toContain('Generic body. extra');
		await checkOracles('tip-body-edit');

		// The caret sits at the end of the edited child, so Enter splits it in place, which
		// must add a child to the container, never to the document root.
		await g.pressEnter();
		await checkOracles('tip-body-split');

		// ── Container, registered: edit the callout's body child ──────────────────
		const noteIndex = await topLevelIndexOf(page, 'callout');
		await g.editContainerBody([noteIndex, 1], ' reg');
		expect(await editor.bridge.getSource()).toContain('Registered body. reg');
		await checkOracles('note-body-edit');

		// ── Insert a container by pasting a copied one (a multi-line fence cannot
		//    form from live typing), then undo ──────────────────────────────────
		tipIndex = await topLevelIndexOf(page, 'directiveContainer');
		const containersBefore = await directiveBlockCount(page);
		await editor.dragFromTo([tipIndex - 1], 40, [tipIndex + 1], 0);
		await g.copySelection();

		await g.clickToReposition([tipIndex + 1]);
		await page.keyboard.press('End');
		await g.pasteHere();
		await page.waitForFunction(
			(n) => document.querySelectorAll('.directive-block').length > n,
			containersBefore,
			{ timeout: 5000, polling: 16 }
		);
		await checkOracles('container-pasted');

		await g.pause();
		await g.undo();
		await checkOracles('container-paste-undo');

		// ── Undo across the widget commit and the change of kind ──────────────────
		await g.undo();
		await checkOracles('note-body-edit-undo');
	});
});

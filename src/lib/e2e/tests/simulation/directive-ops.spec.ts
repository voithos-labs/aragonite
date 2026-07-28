import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCoreOracles } from '../../simulation/invariants';
import { topLevelIndexOf } from './helpers';

// Ungated directive-ops oracle for the `:::name` primitive. The directive surface
// spans three tiers (opaque container, not-mergeable leaf, atomic inline widget)
// and two dispatch paths (a registered name resolves to a factory node, an
// unregistered name to the generic lossless kinds) — none of which the corruption
// oracle stack (structured error + `[invariant:…]` watcher, live-CST round-trip,
// nested-state audit) had ever seen under a state-accumulating watcher. Mirrors
// math-ops / plugin-ops: a loaded document on the plugins route (whose
// `activateDirectives()` call activates the grammar + generic render, and whose
// plugin installs claim note/warning via callout and tip/important/caution via
// admonitions), the directive gesture vocabulary, all oracles re-checked after
// every move, fixed rng for determinism.
//
// `:::note` (registered → callout factory) and `:::mystery` (unregistered → generic
// container) drive both dispatch paths at parse; the gestures then insert a leaf and
// a text widget by real typing, reveal-commit the widget, edit each tier's editable
// surface, drive the leaf's not-mergeable structural path and a container-body
// split, and paste-insert a fresh container — re-checking all three oracles after
// every step.

const DIRECTIVE_DOC =
	'Lead paragraph.\n\n' +
	// `mystery` must stay a name NO harness plugin claims — the generic-tier
	// assertions depend on it. The composed harness owns note/warning (callout)
	// and tip/important/caution (admonitions); a plugin claiming `mystery` fails
	// the generic count assertion loudly, by design.
	':::mystery\nGeneric body.\n:::\n\n' +
	'Middle paragraph.\n\n' +
	':::note Note title\nRegistered body.\n:::\n\n' +
	'Tail paragraph.\n';

class DirectiveSimPage extends EditorPage {
	// `?seed=sim` installs the standing decoration source (sim-mark-plugin) on top of
	// the base plugins, so the oracle stack watches the decoration engine run on every
	// edit. loadContent overrides the seed's (absent) document with DIRECTIVE_DOC.
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins?seed=sim');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

async function directiveBlockCount(page: Page): Promise<number> {
	return page.locator('.directive-block').count();
}

test.describe('directive-ops simulation', () => {
	let editor: DirectiveSimPage;

	test.beforeEach(async ({ page }) => {
		editor = new DirectiveSimPage(page);
		await editor.gotoPlugins();
	});

	test('insert / edit / reveal / structural ops across container, leaf, and text tiers stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(DIRECTIVE_DOC);
		await editor.waitForRenderFlush();
		// Both container dispatch paths resolved at parse: the callout factory for the
		// registered name, the generic container for the unregistered one.
		await expect(page.locator('.callout-block')).toHaveCount(1);
		await expect(page.locator('.directive-block')).toHaveCount(1);

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'directive-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// ── Text tier: insert an inline widget, then reveal → edit → commit ──────
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.insertTextDirective('abbr', 'HTML');
		await expect(page.locator('.directive-text-widget')).toHaveCount(1);
		await checkOracles('text-inserted');

		// Liveness pin for the standing decoration source: the first edit ran the
		// engine's per-edit pass, so the source's overlays must now paint. Otherwise a
		// source that silently stopped emitting would leave the battery green with zero
		// decoration coverage. (loadContent alone fires no edit event, so the source
		// cannot paint before this first commit — hence the pin sits here, not at load.)
		await expect
			.poll(() => page.locator('.decoration-overlay.sim-standing-mark').count())
			.toBeGreaterThan(0);

		// Step past `:abbr[` (6 chars) into the label, insert an 'X', blur to commit.
		await g.revealEditTextDirective(6, 'X', 2);
		expect(await editor.bridge.getSource()).toContain(':abbr[XHTML]');
		await checkOracles('text-edited');

		// ── Leaf tier: insert on a fresh line, edit its info, not-mergeable Backspace ─
		await editor.focusBlockEnd((await editor.bridge.getBlockCount()) - 1);
		await g.pressEnter();
		await g.insertLeafDirective('toc', 'info');
		const leafIndex = (await editor.bridge.getBlockCount()) - 1;
		expect(await editor.bridge.getBlockKind(leafIndex)).toBe('directiveLeaf');
		await checkOracles('leaf-inserted');

		await g.editLeafInfo(leafIndex, ' more');
		expect(await editor.bridge.getSource()).toContain('::toc info more');
		await checkOracles('leaf-edited');

		// Not-mergeable: Backspace at the leaf start must move focus, never concatenate.
		await g.leafBackspaceAtStart(leafIndex);
		await checkOracles('leaf-not-mergeable');

		// ── Container tier (unregistered): body edit, then split the body ────────
		let tipIndex = await topLevelIndexOf(page, 'directiveContainer');
		await g.editContainerBody([tipIndex, 0], ' extra');
		expect(await editor.bridge.getSource()).toContain('Generic body. extra');
		await checkOracles('tip-body-edit');

		// The caret sits at the edited body child's end — Enter splits it in place, a
		// structural op that must grow the container's children, never the root.
		await g.pressEnter();
		await checkOracles('tip-body-split');

		// ── Container tier (registered): edit the callout's body child ───────────
		const noteIndex = await topLevelIndexOf(page, 'note');
		await g.editContainerBody([noteIndex, 1], ' reg');
		expect(await editor.bridge.getSource()).toContain('Registered body. reg');
		await checkOracles('note-body-edit');

		// ── Insert a container by pasting a copied one (a multi-line fence cannot
		//    form from live typing), then undo ──────────────────────────────────
		tipIndex = await topLevelIndexOf(page, 'directiveContainer');
		const containersBefore = await directiveBlockCount(page);
		await editor.dragFromTo([tipIndex - 1], 40, [tipIndex + 1], 0);
		await g.copySelection();

		await g.clickToReposition([tipIndex + 1], 0);
		await page.keyboard.press('End');
		await g.pasteHere();
		await page.waitForFunction(
			(n) => document.querySelectorAll('.directive-block').length > n,
			containersBefore,
			{ timeout: 2000, polling: 16 }
		);
		await checkOracles('container-pasted');

		await g.pause();
		await g.undo();
		await checkOracles('container-paste-undo');

		// ── Undo across the reveal-commit and the leaf promotion ─────────────────
		await g.undo();
		await checkOracles('note-body-edit-undo');
	});
});

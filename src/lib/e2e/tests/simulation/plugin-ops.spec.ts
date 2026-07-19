import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import {
	type SimContext,
	assertNestedStateConsistent,
	assertNoErrors,
	assertRoundTripStable
} from '../../simulation/invariants';

// Ungated plugin-container ops oracle. The simulation's oracle stack (structured
// error + `[invariant:…]` console watcher, live-CST round-trip, nested-state
// audit) is the project's only continuous net for silent stale-`$state`/opaque-
// container corruption, and until this profile it never ran a gesture against a
// plugin container. The three opaque-only invariants (opaque-stale-raw,
// opaque-rebuild-nondeterminism, reserved-chrome-slot) were observable only
// through the plugins project's scripted per-feature scenarios; this brings them
// under a state-accumulating watcher for the first time.
//
// Loaded-ops session (the table-ops pattern): a mixed document holds a `:::note`
// callout and an OPEN `<details>` with prose and a list between them, then the
// gesture vocabulary drives chrome/body typing, Enter-descend, collapse toggle,
// merge-from-below into both collapsed and open containers, a cross-container
// selection copy/paste, and undo/redo — re-checking all three oracles after every
// move. Deterministic like table-ops (fixed rng); run under `--repeat-each` to
// shake out timing flakiness.

const PLUGIN_DOC =
	'Intro paragraph.\n\n' +
	':::note Title\nFirst\n:::\n\n' +
	'- alpha\n- beta\n\n' +
	'<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n\n' +
	'Tail paragraph.\n';

class PluginsSimPage extends EditorPage {
	// `?seed=sim` installs the standing decoration source (sim-mark-plugin) on top of
	// the base plugins, so the oracle stack watches the decoration engine run on every
	// edit. loadContent overrides the seed's (absent) document with PLUGIN_DOC.
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins?seed=sim');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

// ── Spec-local probes ─────────────────────────────────────────────────────────

// Top-level index of the container with `kind` — re-derived before each phase so
// the script survives the transient index shift a merge-into-open introduces.
async function topLevelIndexOf(page: Page, kind: string): Promise<number> {
	return page.evaluate(
		(k) =>
			(window as any).__test
				.getDocument()
				.children.findIndex((c: { kind?: string }) => c.kind === k),
		kind
	);
}

async function rootCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

async function containerRaw(page: Page, kind: string): Promise<string> {
	return page.evaluate((k) => {
		const node = (window as any).__test
			.getDocument()
			.children.find((c: { kind?: string }) => c.kind === k);
		return node?.raw ?? '';
	}, kind);
}

async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
}

// ── Resync-based edit helpers ─────────────────────────────────────────────────
// Every plugin edit lands mid-document (inside a container), never the end-of-doc
// append the ExpectationTracker predicts, so these settle on the observed source
// and resync — the same predict/resync split table-ops uses for cell edits.

async function typeAtPath(ctx: SimContext, path: number[], text: string): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.clickBlockAtPath(path, 0);
	await ctx.page.keyboard.press('End');
	await ctx.page.keyboard.type(text);
	await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

async function typeAtCaret(ctx: SimContext, text: string): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.page.keyboard.type(text);
	await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Enter in a details summary descends into the body without minting a block or
// touching the source (inherited chrome), so it settles on the caret landing in
// the body, not a source delta.
async function enterDescendSummary(ctx: SimContext, detailsIdx: number): Promise<void> {
	await ctx.page.keyboard.press('Enter');
	await expect.poll(() => activeBlockPath(ctx.page)).toEqual([detailsIdx, 1]);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Backspace at the start of the block below the details. Into an OPEN details the
// last body child absorbs it (source delta); into a COLLAPSED one the walk must
// refuse the hidden body and clamp the caret to the summary (no mutation).
async function mergeFromBelow(
	ctx: SimContext,
	tailIdx: number,
	expectMutation: boolean
): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.clickBlockAtPath([tailIdx], 0);
	await ctx.page.keyboard.press('Home');
	await ctx.page.keyboard.press('Backspace');
	if (expectMutation) {
		await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	} else {
		await ctx.editor.waitForNoSourceMutation();
		expect(await ctx.editor.bridge.getSource()).toBe(before);
	}
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

test.describe('plugin-container ops simulation', () => {
	let editor: PluginsSimPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsSimPage(page);
		await editor.gotoPlugins();
	});

	test('chrome/body edits, collapse, cross-boundary merges, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(PLUGIN_DOC);
		await editor.waitForRenderFlush();
		await expect(page.locator('.callout-block')).toHaveCount(1);
		await expect(page.locator('.details-block')).toHaveCount(1);

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'plugin-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = async (label: string): Promise<void> => {
			ctx.label = label;
			await assertNoErrors(ctx);
			await assertRoundTripStable(ctx);
			await assertNestedStateConsistent(ctx);
		};
		await checkOracles('loaded');

		// ── Nested reorder inside an opaque container declines (byte-exact no-op) ──
		// The note sits mid-document, so a mis-scoped reorder would teleport it to a
		// different root index; the gesture asserts the source is byte-identical,
		// putting the resolver's opaque-boundary decline under the oracle stack.
		const declineNoteIdx = await topLevelIndexOf(page, 'note');
		await g.reorderInContainer([declineNoteIdx, 1]);
		await checkOracles('note-body-reorder-declined');

		// ── Callout chrome + body typing ────────────────────────────────────────
		let noteIdx = await topLevelIndexOf(page, 'note');
		await typeAtPath(ctx, [noteIdx, 0], '!');
		// The container raw must have been rebuilt from children — a stale opaque raw
		// would still read `:::note Title`, the opaque-stale-raw invariant's positive check.
		expect(await containerRaw(page, 'note')).toContain(':::note Title!');
		await checkOracles('note-title-edit');

		// Liveness pin for the standing decoration source: the first edit ran the
		// engine's per-edit pass, so the source's overlays must now paint. Otherwise a
		// source that silently stopped emitting would leave the battery green with zero
		// decoration coverage. (loadContent alone fires no edit event, so the source
		// cannot paint before this first commit — hence the pin sits here, not at load.)
		await expect
			.poll(() => page.locator('.decoration-overlay.sim-standing-mark').count())
			.toBeGreaterThan(0);

		await typeAtPath(ctx, [noteIdx, 1], ' more');
		await checkOracles('note-body-edit');

		// Command-dispatch gesture: a real minted-command chord bubbles from a
		// callout leaf to the container handler and commits a metadataUpdate.
		await g.pause();
		await g.setCalloutKind();
		expect(await containerRaw(page, 'note')).toContain(':::warning');
		await checkOracles('note-set-kind');

		// ── Read-only global-command detour (net identity) ──────────────────────
		// A plugin-registered global chord (doc-stats' Mod+Shift+S) fires mid-session,
		// reads the per-instance EditorContext, and republishes `window.__docStats`. It
		// commits nothing, so the source and the undo stack must be byte-identical
		// across it — the plugin command spine under the corruption oracle without
		// disturbing the equality spine.
		await g.pause();
		const beforeDocStats = await editor.bridge.getSource();
		const undoBefore = await page.evaluate(() => (window as any).__test.dumpUndoStack());
		await g.publishDocStats();
		expect(await editor.bridge.getSource()).toBe(beforeDocStats);
		expect(await page.evaluate(() => (window as any).__test.dumpUndoStack())).toBe(undoBefore);
		await checkOracles('global-command-docstats');

		// ── Split the callout body, then undo/redo the split's typing ───────────
		await g.pause();
		await editor.clickBlockAtPath([noteIdx, 1], 0);
		await page.keyboard.press('End');
		await g.pressEnter();
		await checkOracles('note-body-split');

		await typeAtCaret(ctx, 'second');
		await checkOracles('note-split-typed');

		await g.pause();
		await g.undo();
		await checkOracles('note-split-undo');
		await g.redo();
		await checkOracles('note-split-redo');

		// ── Details chrome edit, Enter-descend, body typing ─────────────────────
		let detailsIdx = await topLevelIndexOf(page, 'details');
		await typeAtPath(ctx, [detailsIdx, 0], 'Z');
		await checkOracles('summary-edit');

		await enterDescendSummary(ctx, detailsIdx);
		await checkOracles('summary-enter-descend');

		await typeAtCaret(ctx, 'pre');
		expect(await editor.bridge.getSource()).toContain('preBody');
		await checkOracles('details-body-edit');

		// ── Collapse, merge-from-below into the collapsed container, expand ─────
		await g.pause();
		await g.toggleCollapse();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		await checkOracles('collapsed');

		detailsIdx = await topLevelIndexOf(page, 'details');
		let tailIdx = (await rootCount(page)) - 1;
		await mergeFromBelow(ctx, tailIdx, false);
		// The clamp refused the hidden body: caret parked on the summary, tail intact.
		expect(await activeBlockPath(page)).toEqual([detailsIdx, 0]);
		await checkOracles('merge-into-collapsed');

		await g.toggleCollapse();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		await checkOracles('expanded');

		// ── Merge-from-below into the OPEN container, then undo ──────────────────
		tailIdx = (await rootCount(page)) - 1;
		await mergeFromBelow(ctx, tailIdx, true);
		expect(await editor.bridge.getSource()).toContain('Tail paragraph');
		await checkOracles('merge-into-open');

		await g.pause();
		await g.undo();
		await checkOracles('merge-undo');

		// ── Cross-container selection → copy → paste → undo ─────────────────────
		// Drag a selection from the callout body, across the list and the container
		// boundaries, to the details summary — the aliasing stressor a clipboard
		// commit spanning two opaque containers exposes.
		noteIdx = await topLevelIndexOf(page, 'note');
		detailsIdx = await topLevelIndexOf(page, 'details');
		await editor.dragFromTo([noteIdx, 1], 0, [detailsIdx, 0], 3);
		await g.copySelection();

		tailIdx = (await rootCount(page)) - 1;
		await g.clickToReposition([tailIdx], 0);
		await page.keyboard.press('End');
		await g.pasteHere();
		await checkOracles('cross-container-paste');

		await g.pause();
		await g.undo();
		await checkOracles('cross-container-undo');

		// ── Paste a GitHub alert → the admonitions pre-parse transform ──────────
		// The transform rewrites the pasted `> [!TIP]` blockquote to a `:::tip`
		// admonition before the parse, bringing the content-keyed paste surface
		// under the round-trip/nested-state/no-errors oracles.
		tailIdx = (await rootCount(page)) - 1;
		await g.clickToReposition([tailIdx], 0);
		await page.keyboard.press('End');
		await g.pasteGithubAlert();
		await checkOracles('github-alert-paste');

		await g.pause();
		await g.undo();
		await checkOracles('github-alert-paste-undo');
	});
});

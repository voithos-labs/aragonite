import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCoreOracles } from '../../simulation/invariants';
import { topLevelIndexOf } from './helpers';
import { PluginsPage, activeBlockPath } from '../plugins/helpers';

// Ungated plugin-container ops oracle. The three opaque-only invariants (opaque-stale-raw,
// opaque-rebuild-nondeterminism, reserved-chrome-slot) were observable only through scripted
// per-feature scenarios; this brings them under a STATE-ACCUMULATING watcher for the first
// time. A loaded-ops session on the table-ops pattern, deterministic under a fixed rng — run
// with `--repeat-each` to shake out timing flakiness.

const PLUGIN_DOC =
	'Intro paragraph.\n\n' +
	':::callout Title\nFirst\n:::\n\n' +
	'- alpha\n- beta\n\n' +
	'<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n\n' +
	'Tail paragraph.\n';

// ── Spec-local probes ─────────────────────────────────────────────────────────

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
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// `?seed=sim` installs the standing decoration source (sim-mark-plugin) on top of
		// the base plugins, so the oracle stack watches the decoration engine run on every
		// edit. loadContent overrides the seed's (absent) document with PLUGIN_DOC.
		await editor.gotoPlugins('sim');
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

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// ── Nested reorder inside an opaque container declines (byte-exact no-op) ──
		// The note sits mid-document, so a mis-scoped reorder would teleport it to a
		// different root index; the gesture asserts the source is byte-identical,
		// putting the resolver's opaque-boundary decline under the oracle stack.
		const declineNoteIdx = await topLevelIndexOf(page, 'callout');
		await g.reorderInContainer([declineNoteIdx, 1]);
		await checkOracles('note-body-reorder-declined');

		// ── Callout chrome + body typing ────────────────────────────────────────
		let noteIdx = await topLevelIndexOf(page, 'callout');
		await typeAtPath(ctx, [noteIdx, 0], '!');
		// The container raw must have been rebuilt from children — a stale opaque raw
		// would still read `:::callout Title`, the opaque-stale-raw invariant's positive check.
		expect(await containerRaw(page, 'callout')).toContain(':::callout Title!');
		await checkOracles('callout-title-edit');

		// Liveness pin: a source that silently stopped emitting would leave the battery green
		// with zero decoration coverage. It sits after the FIRST EDIT, not at load, because
		// `loadContent` fires no edit event and the source cannot paint before that commit.
		await expect
			.poll(() => page.locator('.decoration-overlay.sim-standing-mark').count())
			.toBeGreaterThan(0);

		await typeAtPath(ctx, [noteIdx, 1], ' more');
		await checkOracles('note-body-edit');

		// Command-dispatch gesture: a real minted-command chord bubbles from a
		// callout leaf to the container handler and commits a metadataUpdate.
		await g.pause();
		await g.setCalloutKind();
		expect(await containerRaw(page, 'callout')).toContain(':::aside');
		await checkOracles('note-set-kind');

		// ── Read-only global-command detour (net identity) ──────────────────────
		// A plugin-registered GLOBAL chord commits nothing, so source and undo stack must be
		// byte-identical across it — the command spine under the corruption oracle without
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
		noteIdx = await topLevelIndexOf(page, 'callout');
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

		// ── Paste a GitHub alert → the native githubAlert grammar ───────────────
		// Conversion is opt-in since 0.9.34, so the pasted `> [!TIP]` blockquote
		// keeps its bytes and parses as a first-class githubAlert container,
		// bringing the native alert paste path under the
		// round-trip/nested-state/no-errors oracles.
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

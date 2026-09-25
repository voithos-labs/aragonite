import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext, topLevelIndexOf } from './helpers';
import { PluginsPage, activeBlockPath } from '../plugins/helpers';

// Plugin containers, run in the default gate. The three rules that apply only to opaque
// containers (its raw text must never go stale, a rebuild must be repeatable, and the title row
// keeps its place) could be seen only through short scripted scenarios; this runs them inside a
// long session for the first time. Built like table-ops, on a loaded document, and repeatable
// under a fixed generator; run it with `--repeat-each` to shake out timing flakiness.

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

// ── Edits that resync ─────────────────────────────────────────────────────────
// Every plugin edit lands inside a container, in the middle of the document, never as text
// added at the end, which is all the ExpectationTracker predicts, so these wait for the source
// and resync, the same split table-ops uses for cell edits.

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

// Enter in a details summary moves into the body without creating a block or changing the
// source, so this waits for the caret to reach the body rather than for the source to change.
async function enterDescendSummary(ctx: SimContext, detailsIdx: number): Promise<void> {
	await ctx.page.keyboard.press('Enter');
	await expect.poll(() => activeBlockPath(ctx.page)).toEqual([detailsIdx, 1]);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Backspace at the start of the block below the details. With the details open, the last body
// child takes it and the source changes; with it collapsed, the walk must refuse the hidden
// body and stop the caret at the summary, changing nothing.
async function mergeFromBelow(
	ctx: SimContext,
	tailIdx: number,
	expectMutation: boolean
): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.clickBlockAtPath([tailIdx], 0);
	await ctx.page.keyboard.press('Home');
	if (expectMutation) {
		await ctx.page.keyboard.press('Backspace');
		await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	} else {
		await ctx.editor.pressDeclined('Backspace');
		expect(await ctx.editor.bridge.getSource()).toBe(before);
	}
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

test.describe('plugin-container ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// `?seed=sim` adds the decoration source (sim-mark-plugin) to the base plugins, so the
		// checks watch decorations run on every edit. `loadContent` replaces the seed's empty
		// document with PLUGIN_DOC.
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

		const ctx = await makeSimContext(page, editor, 'plugin-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		await assertCheckpoint(ctx, 'loaded');

		// ── A move inside an opaque container is refused and changes no bytes ──────
		// The note sits mid-document, so a move that looked outside the container would jump it
		// to a different position; the gesture checks the source is identical, which puts that
		// refusal under these checks.
		const declineNoteIdx = await topLevelIndexOf(page, 'callout');
		await g.reorderInContainer([declineNoteIdx, 1]);
		await assertCheckpoint(ctx, 'note-body-reorder-declined');

		// ── Typing in the callout's title and body ───────────────────────────────
		let noteIdx = await topLevelIndexOf(page, 'callout');
		await typeAtPath(ctx, [noteIdx, 0], '!');
		// The container's raw text must have been rebuilt from its children: raw text left
		// stale would still read `:::callout Title`.
		expect(await containerRaw(page, 'callout')).toContain(':::callout Title!');
		await assertCheckpoint(ctx, 'callout-title-edit');

		// Proves the decoration source is alive: one that quietly stopped would leave this suite
		// green with no decoration coverage at all. It comes after the first edit, not at load,
		// since `loadContent` fires no edit event and nothing is drawn before that commit.
		await expect
			.poll(() => page.locator('.decoration-overlay.sim-standing-mark').count())
			.toBeGreaterThan(0);

		await typeAtPath(ctx, [noteIdx, 1], ' more');
		await assertCheckpoint(ctx, 'note-body-edit');

		// Command dispatch: a real shortcut for a plugin command travels from a callout child up
		// to the container's handler and commits a metadata update.
		await g.pause();
		await g.setCalloutKind();
		expect(await containerRaw(page, 'callout')).toContain(':::aside');
		await assertCheckpoint(ctx, 'note-set-kind');

		// ── A global command that only reads changes nothing ──────────────────────
		// A global shortcut a plugin registered commits nothing, so the source and the undo
		// stack must be identical across it: command dispatch is covered without disturbing
		// the document the end state is compared against.
		await g.pause();
		const beforeDocStats = await editor.bridge.getSource();
		const undoBefore = await page.evaluate(() => (window as any).__test.dumpUndoStack());
		await g.publishDocStats();
		expect(await editor.bridge.getSource()).toBe(beforeDocStats);
		expect(await page.evaluate(() => (window as any).__test.dumpUndoStack())).toBe(undoBefore);
		await assertCheckpoint(ctx, 'global-command-docstats');

		// ── Split the callout body, then undo/redo the split's typing ───────────
		await g.pause();
		await editor.clickBlockAtPath([noteIdx, 1], 0);
		await page.keyboard.press('End');
		await g.pressEnter();
		await assertCheckpoint(ctx, 'note-body-split');

		await typeAtCaret(ctx, 'second');
		await assertCheckpoint(ctx, 'note-split-typed');

		await g.pause();
		await g.undo();
		await assertCheckpoint(ctx, 'note-split-undo');
		await g.redo();
		await assertCheckpoint(ctx, 'note-split-redo');

		// ── Edit the details summary, Enter into the body, type there ────────────
		let detailsIdx = await topLevelIndexOf(page, 'details');
		await typeAtPath(ctx, [detailsIdx, 0], 'Z');
		await assertCheckpoint(ctx, 'summary-edit');

		await enterDescendSummary(ctx, detailsIdx);
		await assertCheckpoint(ctx, 'summary-enter-descend');

		await typeAtCaret(ctx, 'pre');
		expect(await editor.bridge.getSource()).toContain('preBody');
		await assertCheckpoint(ctx, 'details-body-edit');

		// ── Collapse, merge-from-below into the collapsed container, expand ─────
		await g.pause();
		await g.toggleCollapse();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		await assertCheckpoint(ctx, 'collapsed');

		detailsIdx = await topLevelIndexOf(page, 'details');
		let tailIdx = (await rootCount(page)) - 1;
		await mergeFromBelow(ctx, tailIdx, false);
		// The hidden body was refused: the caret stopped at the summary and the block below
		// is intact.
		expect(await activeBlockPath(page)).toEqual([detailsIdx, 0]);
		await assertCheckpoint(ctx, 'merge-into-collapsed');

		await g.toggleCollapse();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		await assertCheckpoint(ctx, 'expanded');

		// ── Merge-from-below into the OPEN container, then undo ──────────────────
		tailIdx = (await rootCount(page)) - 1;
		await mergeFromBelow(ctx, tailIdx, true);
		expect(await editor.bridge.getSource()).toContain('Tail paragraph');
		await assertCheckpoint(ctx, 'merge-into-open');

		await g.pause();
		await g.undo();
		await assertCheckpoint(ctx, 'merge-undo');

		// ── Select across containers, copy, paste, undo ──────────────────────────
		// Drag a selection from the callout body, across the list and out of both containers,
		// to the details summary: a clipboard commit spanning two opaque containers is where
		// shared nodes cause trouble.
		noteIdx = await topLevelIndexOf(page, 'callout');
		detailsIdx = await topLevelIndexOf(page, 'details');
		await editor.dragFromTo([noteIdx, 1], 0, [detailsIdx, 0], 3);
		await g.copySelection();

		tailIdx = (await rootCount(page)) - 1;
		await g.clickToReposition([tailIdx]);
		await page.keyboard.press('End');
		await g.pasteHere();
		await assertCheckpoint(ctx, 'cross-container-paste');

		await g.pause();
		await g.undo();
		await assertCheckpoint(ctx, 'cross-container-undo');

		// ── Paste a GitHub alert, which parses as a githubAlert ──────────────────
		// Converting is opt-in, so the pasted `> [!TIP]` blockquote keeps its bytes and parses
		// as a githubAlert container, bringing that paste under the round-trip, nested-state
		// and no-errors checks.
		tailIdx = (await rootCount(page)) - 1;
		await g.clickToReposition([tailIdx]);
		await page.keyboard.press('End');
		await g.pasteGithubAlert();
		await assertCheckpoint(ctx, 'github-alert-paste');

		await g.pause();
		await g.undo();
		await assertCheckpoint(ctx, 'github-alert-paste-undo');
	});
});

import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';
import { waitForNodeCount } from './node-count';

// Footnote gestures (plugins route, `?seed=footnotes`), covering two parts: the `[^label]: `
// definition block and the `[^label]` inline reference widget. Each waits for the block to
// change kind or for the widget to swap in, then resyncs after the reparse. The number a
// reference shows is worked out for display and never modelled here, so nothing in this file
// predicts or checks it; the reference's own e2e test does that.

const DEF = '.footnote-def';
const REF = '.footnote-ref';

// ── Definition tier ───────────────────────────────────────────────────────────

/**
 * The marker built by typing. Typed one key at a time, which takes the line through a
 * short-lived inline reference widget before the reparse settles it into a definition marker:
 * the in-between state a real writer produces and a one-shot insert never reaches.
 */
export async function typeFootnoteDefinition(
	ctx: SimContext,
	targetIndex: number,
	label: string,
	body: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const defsBefore = await page.locator(DEF).count();

	await editor.focusBlockStart(targetIndex);
	await page.keyboard.press('Shift+End');
	// The space after the marker is not typed: closing it with `:` completes it to `[^label]: `,
	// so typing a space here would add a second one.
	await editor.typeSlowly(`[^${label}]:`);
	await editor.typeSlowly(body);
	await editor.bridge.waitForSourceContains(`[^${label}]: ${body}`);
	await waitForNodeCount(ctx, DEF, defsBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The definition splits the way a blockquote does, so the split has to add a child to the
 * container and never to the document root. Both counts are checked, so a split that escaped
 * the container throws.
 */
export async function splitFootnoteDefinitionBody(
	ctx: SimContext,
	bodyPath: number[]
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const defIndex = bodyPath[0];
	const before = await containerAndRootCounts(page, defIndex);

	const mid = await page.evaluate((path) => {
		let node = (window as any).__test.getDocument();
		for (const i of path) node = node.children?.[i];
		const raw = ((node?.raw ?? '') as string).replace(/\n+$/, '');
		return Math.max(1, Math.floor(raw.length / 2));
	}, bodyPath);
	await editor.clickBlockAtPath(bodyPath, mid);
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		({ i, n }) => (window as any).__test.getDocument().children[i]?.children?.length === n,
		{ i: defIndex, n: before.children + 1 },
		{ timeout: 5000, polling: 16 }
	);

	const after = await containerAndRootCounts(page, defIndex);
	if (after.root !== before.root) {
		throw new Error(
			`[${ctx.label}] footnote-def body split escaped the container to the root ` +
				`(root ${before.root} → ${after.root}): the blockquote split override did not hold`
		);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at the start of the first child lifts it out of the definition
 * (`lift-first-child-keep-container`): it becomes the paragraph before the marker and the rest
 * of the body stays under it, while a definition with one child turns into that paragraph.
 * Waits for the source to change, then reads the tree back to check the shape.
 */
export async function footnoteDefinitionExitBackspace(
	ctx: SimContext,
	bodyPath: number[]
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const defIndex = bodyPath[0];
	const before = await editor.bridge.getSource();
	const counts = await containerAndRootCounts(page, defIndex);

	await editor.clickBlockAtPath(bodyPath, 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();

	const shape = await page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		return {
			liftedKind: doc.children[i]?.kind ?? null,
			nextKind: doc.children[i + 1]?.kind ?? null,
			nextChildren: doc.children[i + 1]?.children?.length ?? 0,
			root: doc.children.length
		};
	}, defIndex);
	const keepsContainer = counts.children > 1;
	const lifted =
		shape.liftedKind === 'paragraph' &&
		(keepsContainer
			? shape.nextKind === 'footnote-def' &&
				shape.nextChildren === counts.children - 1 &&
				shape.root === counts.root + 1
			: shape.root === counts.root);
	const after = await editor.bridge.getSource();
	if (!lifted) {
		throw new Error(
			`[${ctx.label}] footnote-def Backspace-at-start did not lift the first body child ` +
				`(${JSON.stringify(shape)} from ${JSON.stringify(counts)}).\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	tracker.resync(after);
}

// ── Reference tier ────────────────────────────────────────────────────────────

/**
 * The widget hides the bytes but keeps them, so the source holds the reference from the moment
 * it is typed: what marks the widget arriving is the count rising, not new text.
 */
export async function typeFootnoteReference(ctx: SimContext, label: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const refsBefore = await page.locator(REF).count();

	await editor.typeSlowly(`[^${label}]`);
	await editor.bridge.waitForSourceContains(`[^${label}]`);
	await waitForNodeCount(ctx, REF, refsBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Only the view changes: the source is present in both states, just dimmed, so the widget count
 * is the one sign it opened, and the bytes must be identical all the way round.
 */
export async function revealFootnoteReference(
	ctx: SimContext,
	refIndex: number,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const refsBefore = await page.locator(REF).count();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('ArrowRight');
	await waitForNodeCount(ctx, REF, refsBefore - 1);

	await editor.clickBlock(blurBlockIndex);
	await waitForNodeCount(ctx, REF, refsBefore);
	await editor.waitForRenderFlush();

	const after = await editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`[${ctx.label}] reference reveal→fold changed the source (view toggle must be byte-stable).\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	tracker.resync(after);
}

/**
 * The show-edit-commit behaviour this widget shares with inline math. The edit is kept out of
 * the tree until the commit, so waiting for the source to change before the blur would race
 * the DOM.
 */
export async function editFootnoteLabel(
	ctx: SimContext,
	refIndex: number,
	text: string,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('ArrowRight'); // opens it, caret at the front of the shown source
	await page.keyboard.press('ArrowRight'); // past `[`
	await page.keyboard.press('ArrowRight'); // past `^` — now at the label start
	await page.keyboard.type(text);
	await blurToCommit(ctx, blurBlockIndex, before);

	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * A Delete next to a closed reference opens it rather than removing it whole, so the first
 * press only opens it and the second takes the opening `[`, leaving the rest as ordinary text.
 * The caller closes with an undo, so the bytes come back.
 */
export async function deleteFootnoteReference(
	ctx: SimContext,
	refIndex: number,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const refsBefore = await page.locator(REF).count();
	const before = await editor.bridge.getSource();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('Delete'); // opens it, deletes nothing
	await page.keyboard.press('Delete'); // remove the opening `[`
	await blurToCommit(ctx, blurBlockIndex, before); // commits, leaving plain text
	await waitForNodeCount(ctx, REF, refsBefore - 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Blur is the commit that works wherever the widget sits: Enter splits the block
 * (`latex-inline-reveal-commands`), and a reference at a block's edge has no position beside it
 * for the caret to step out to. Committing by stepping out is covered by the math gestures.
 */
async function blurToCommit(
	ctx: SimContext,
	blurBlockIndex: number,
	before: string
): Promise<void> {
	await ctx.editor.clickBlock(blurBlockIndex);
	await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
}

/** Block path and `data-source-start` offset of the Nth rendered reference widget. */
async function nthRefIsland(
	page: Page,
	refIndex: number
): Promise<{ blockPath: number[]; start: number }> {
	return page.evaluate((idx) => {
		const sup = document.querySelectorAll('.footnote-ref')[idx];
		if (!sup) throw new Error(`no .footnote-ref at index ${idx}`);
		const island = sup.closest('[data-inline-widget]');
		const host = sup.closest('[data-block-path]');
		const path = host?.getAttribute('data-block-path');
		const start = island?.getAttribute('data-source-start');
		if (path === null || path === undefined || start === null || start === undefined) {
			throw new Error('footnote-ref widget/host is missing its offset attributes');
		}
		return { blockPath: JSON.parse(path) as number[], start: Number(start) };
	}, refIndex);
}

/** How many children the container at `defIndex` holds, and how many the document root does. */
async function containerAndRootCounts(
	page: Page,
	defIndex: number
): Promise<{ children: number; root: number }> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		return { children: doc.children[i]?.children?.length ?? 0, root: doc.children.length };
	}, defIndex);
}

import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';
import { waitForNodeCount } from './node-count';

// Footnote gestures (plugins route, `?seed=footnotes`), spanning two tiers: the `[^label]: `
// strip-container definition and the `[^label]` inline reference widget. Each gates on the
// promotion or widget swap and RESYNCS around the reparse — never predicts across a mount
// boundary. The number a reference renders is derived display state the tracker never models,
// so nothing here predicts or asserts it; the reference e2e is that oracle.

const DEF = '.footnote-def';
const REF = '.footnote-ref';

// ── Definition tier ───────────────────────────────────────────────────────────

/**
 * Marker formation from live typing. Typed PER KEYSTROKE, which routes the line through a
 * transient inline reference widget before the reparse resolves it to a definition marker —
 * the intermediate state a real author produces and an atomic insert never reaches.
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
	// The separating space is NOT typed: closing the marker with `:` auto-completes it to
	// `[^label]: `, so a literal space here would land a second one.
	await editor.typeSlowly(`[^${label}]:`);
	await editor.typeSlowly(body);
	await editor.bridge.waitForSourceContains(`[^${label}]: ${body}`);
	await waitForNodeCount(ctx, DEF, defsBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The strip container inherits blockquote's split override, so the split must grow the
 * CONTAINER's children and never the document root. Asserts both counts, failing loud if the
 * split escaped.
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
		{ timeout: 2000, polling: 16 }
	);

	const after = await containerAndRootCounts(page, defIndex);
	if (after.root !== before.root) {
		throw new Error(
			`[${ctx.label}] footnote-def body split escaped the container to the root ` +
				`(root ${before.root} → ${after.root}) — the blockquote split override did not hold`
		);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at the first body child's start lifts that child out of the definition
 * (`lift-first-child-keep-container`): it becomes the paragraph before the marker and the rest
 * of the body stays under it; a single-child definition dissolves into that paragraph. Gates on
 * the source changing, then asserts the shape by re-reading the tree.
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
 * The widget hides but preserves the literal bytes, so the source carries the reference the
 * instant it is typed — the mount signal is the COUNT rising, not a new substring.
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
 * A pure view toggle: the source is dimmed-but-present in both states, so the widget COUNT is
 * the only reveal signal and the bytes must be identical across the whole round trip.
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
 * The reveal→edit→commit UX this widget shares with inline math. The edit is suppressed from
 * the CST until commit, so settling on the source delta before the blur races the reveal DOM.
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
	await page.keyboard.press('ArrowRight'); // reveal (caret at the revealed leading edge)
	await page.keyboard.press('ArrowRight'); // past `[`
	await page.keyboard.press('ArrowRight'); // past `^` — now at the label start
	await page.keyboard.type(text);
	await blurToCommit(ctx, blurBlockIndex, before);

	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * A destructive key adjacent to a folded reference REVEALS it rather than deleting it whole,
 * so the first Delete only reveals and the second removes the opening `[` — leaving the rest
 * as ordinary text. The caller nets it to identity with a trailing undo.
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
	await page.keyboard.press('Delete'); // reveal, no byte deleted
	await page.keyboard.press('Delete'); // remove the opening `[`
	await blurToCommit(ctx, blurBlockIndex, before); // commit → literal text
	await waitForNodeCount(ctx, REF, refsBefore - 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Blur is the commit that holds WHEREVER the widget sits: Enter is the block's split key
 * (`latex-inline-reveal-commands`), and a block-edge reference has no adjacent position for a
 * caret escape to land in. The caret-escape commit is covered by the inline-math gestures.
 */
async function blurToCommit(
	ctx: SimContext,
	blurBlockIndex: number,
	before: string
): Promise<void> {
	await ctx.editor.clickBlock(blurBlockIndex);
	await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
}

/** Block path + `data-source-start` offset of the Nth rendered reference widget island. */
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
			throw new Error('footnote-ref island/host is missing its offset attributes');
		}
		return { blockPath: JSON.parse(path) as number[], start: Number(start) };
	}, refIndex);
}

/** Body-child count of the container at `defIndex` and the document root count, together. */
async function containerAndRootCounts(
	page: Page,
	defIndex: number
): Promise<{ children: number; root: number }> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		return { children: doc.children[i]?.children?.length ?? 0, root: doc.children.length };
	}, defIndex);
}

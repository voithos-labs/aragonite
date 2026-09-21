import { type SimContext } from '../invariants';
import { arrowRightToOffset, cursorOffset } from './caret-walk';

// Decoration gestures (plugins route, `?seed=sim`). Decorations are for display only, so
// drawing one never changes the source. Only deleting a replace decoration and backspacing
// through a see-through one move bytes, and an undo puts both back.

const ISLAND = '[data-decoration-island]';
const SELECTED = '.md-widget-selected';

interface IslandSpan {
	start: number;
	end: number;
	kind: 'replace' | 'widget';
}

// ── Reading a decoration ─────────────────────────────────────────────────────

async function readIsland(ctx: SimContext, blockIndex: number): Promise<IslandSpan> {
	const span = await ctx.page.evaluate((i) => {
		const host = document.querySelector(`[data-block-path='${JSON.stringify([i])}']`);
		const island = host?.querySelector('[data-decoration-island]');
		if (!island) return null;
		return {
			start: Number(island.getAttribute('data-source-start')),
			end: Number(island.getAttribute('data-source-end'))
		};
	}, blockIndex);
	if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) {
		throw new Error(`[${ctx.label}] no decoration widget in block ${blockIndex}`);
	}
	return { ...span, kind: span.end > span.start ? 'replace' : 'widget' };
}

async function islandCount(ctx: SimContext, blockIndex: number): Promise<number> {
	return ctx.page.locator(`[data-block-path='${JSON.stringify([blockIndex])}'] ${ISLAND}`).count();
}

// ── Gestures ─────────────────────────────────────────────────────────────────

/**
 * A replace decoration is stepped over in one go, so the exact offsets on each side are what
 * this checks; a zero-width widget is see-through and the caret crosses onto the real byte
 * beside it. Either way the source must be identical afterwards.
 */
export async function walkAcrossIsland(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, end, kind } = await readIsland(ctx, blockIndex);
	const before = await editor.bridge.getSource();

	if (kind === 'replace') {
		await arrowRightToOffset(ctx, blockIndex, start);
		await page.keyboard.press('ArrowRight');
		await assertCursor(ctx, blockIndex, end, 'replace step-over lands past the hidden range');
		if ((await page.locator(SELECTED).count()) !== 0) {
			throw new Error(`[${ctx.label}] a step-over arrow selected the replace decoration`);
		}
		await page.keyboard.press('ArrowLeft');
		await assertCursor(ctx, blockIndex, start, 'replace step-back lands at the leading edge');
	} else {
		await arrowRightToOffset(ctx, blockIndex, start);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		const after = await cursorOffset(ctx, blockIndex);
		if (after === null || after <= start) {
			throw new Error(
				`[${ctx.label}] widget decoration trapped the caret at offset ${after} (widget offset ${start})`
			);
		}
		if ((await page.locator(SELECTED).count()) !== 0) {
			throw new Error(`[${ctx.label}] arrowing across the widget decoration selected it`);
		}
	}

	await assertUnchanged(ctx, before, 'island walk');
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * Two presses to select and delete, then an undo, so the bytes end up unchanged. The check
 * that matters is on the first press: it selects the whole decoration and must leave the
 * hidden bytes exactly as they were, so a quietly swallowed byte fails here rather than
 * hiding inside the delete.
 */
export async function edgeDeleteReplaceIsland(
	ctx: SimContext,
	blockIndex: number,
	key: 'Backspace' | 'Delete'
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, end, kind } = await readIsland(ctx, blockIndex);
	if (kind !== 'replace') {
		throw new Error(
			`[${ctx.label}] edgeDeleteReplaceIsland needs a replace decoration in ${blockIndex}`
		);
	}
	const before = await editor.bridge.getSource();
	const edge = key === 'Backspace' ? end : start;
	await arrowRightToOffset(ctx, blockIndex, edge);

	await page.keyboard.press(key);
	await editor.waitForRenderFlush();
	if ((await page.locator(SELECTED).count()) !== 1) {
		throw new Error(`[${ctx.label}] first ${key} did not select the replace decoration whole`);
	}
	if ((await editor.bridge.getSource()) !== before) {
		throw new Error(
			`[${ctx.label}] first ${key} changed the source: the hidden bytes must survive until the ` +
				`second press.
BEFORE: ${JSON.stringify(before)}`
		);
	}

	await page.keyboard.press(key);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * The decoration is see-through, so the press takes the real byte beside it and never just
 * strips the decoration's own DOM. The widget sits at the front of the word it marks, so the
 * byte taken is the space before it and the word survives to grow the decoration again.
 */
export async function backspaceThroughWidgetIsland(
	ctx: SimContext,
	blockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, kind } = await readIsland(ctx, blockIndex);
	if (kind !== 'widget') {
		throw new Error(
			`[${ctx.label}] backspaceThroughWidgetIsland needs a widget decoration in ${blockIndex}`
		);
	}
	const before = await editor.bridge.getSource();
	if (start === 0)
		throw new Error(`[${ctx.label}] widget decoration at offset 0 has no adjacent byte`);

	await arrowRightToOffset(ctx, blockIndex, start);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await islandCount(ctx, blockIndex)) !== 1) {
		throw new Error(
			`[${ctx.label}] the widget decoration vanished after the transparent backspace`
		);
	}

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * The bytes end up unchanged. The typed character lands next to the decoration, whose own text
 * is untouched, so the decoration is derived again and the count holds across the edit.
 */
export async function typeAdjacentToIsland(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await readIsland(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const islandsBefore = await islandCount(ctx, blockIndex);

	await arrowRightToOffset(ctx, blockIndex, end);
	await page.keyboard.type('q');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await islandCount(ctx, blockIndex)) !== islandsBefore) {
		throw new Error(
			`[${ctx.label}] an adjacent insert perturbed the widget count in ${blockIndex}`
		);
	}

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * A block decoration is keyed on the block's content, so the badge has to follow the bytes to
 * the new position and back. That rule has its own e2e test; this one runs it in the middle of
 * a long session.
 */
export async function reorderDecoratedBlock(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	await assertBadgeAt(ctx, blockIndex, true, 'badge present before reorder');

	await editor.clickBlock(blockIndex);
	await editor.waitForRenderFlush();
	await page.keyboard.press('Alt+ArrowDown');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await assertBadgeAt(ctx, blockIndex + 1, true, 'badge followed the block down');
	await assertBadgeAt(ctx, blockIndex, false, 'no badge left at the vacated path');

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await assertBadgeAt(ctx, blockIndex, true, 'badge returned after undo');
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

// ── Assertions ───────────────────────────────────────────────────────────────

async function assertCursor(
	ctx: SimContext,
	blockIndex: number,
	expected: number,
	what: string
): Promise<void> {
	const actual = await cursorOffset(ctx, blockIndex);
	if (actual !== expected) {
		throw new Error(`[${ctx.label}] ${what}: expected caret offset ${expected}, got ${actual}`);
	}
}

async function assertUnchanged(ctx: SimContext, before: string, what: string): Promise<void> {
	const now = await ctx.editor.bridge.getSource();
	if (now !== before) {
		throw new Error(
			`[${ctx.label}] ${what} changed the source.\nBEFORE: ${JSON.stringify(before)}\n` +
				`AFTER:  ${JSON.stringify(now)}`
		);
	}
}

async function assertBadgeAt(
	ctx: SimContext,
	blockIndex: number,
	present: boolean,
	what: string
): Promise<void> {
	const selector = `[data-block-path='${JSON.stringify([blockIndex])}'].sim-badged-block`;
	await ctx.page
		.waitForFunction(
			({ sel, want }) => (document.querySelector(sel) !== null) === want,
			{ sel: selector, want: present },
			{ timeout: 5000, polling: 16 }
		)
		.catch(() => {
			throw new Error(`[${ctx.label}] ${what}: badge presence at ${blockIndex} was not ${present}`);
		});
}

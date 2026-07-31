import { type SimContext } from '../invariants';

// Decoration-tier gestures (plugins route, `?seed=sim`). Decorations are view-only, so
// painting never changes the source — only the replace delete and the transparent widget
// backspace move bytes, and both net to identity via undo.

const ISLAND = '[data-decoration-island]';
const SELECTED = '.md-widget-selected';

interface IslandSpan {
	start: number;
	end: number;
	kind: 'replace' | 'widget';
}

// ── Island reads ─────────────────────────────────────────────────────────────

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
		throw new Error(`[${ctx.label}] no decoration island in block ${blockIndex}`);
	}
	return { ...span, kind: span.end > span.start ? 'replace' : 'widget' };
}

async function islandCount(ctx: SimContext, blockIndex: number): Promise<number> {
	return ctx.page.locator(`[data-block-path='${JSON.stringify([blockIndex])}'] ${ISLAND}`).count();
}

async function cursorOffset(ctx: SimContext, blockIndex: number): Promise<number | null> {
	return ctx.page.evaluate(
		(i) => (window as any).__test.getBlockCursorSurface([i]).cursorOffset,
		blockIndex
	);
}

// The atomic step-over lands the caret exactly on a far edge, so every reachable offset is
// hit exactly and an over-step past `target` trips the guard rather than looping forever.
async function arrowRightToOffset(
	ctx: SimContext,
	blockIndex: number,
	target: number
): Promise<void> {
	await ctx.editor.focusBlockStart(blockIndex);
	for (let guard = 0; guard <= target + 8; guard++) {
		if ((await cursorOffset(ctx, blockIndex)) === target) return;
		await ctx.page.keyboard.press('ArrowRight');
	}
	throw new Error(
		`[${ctx.label}] could not land the caret at raw offset ${target} in block ${blockIndex} ` +
			`(reached ${await cursorOffset(ctx, blockIndex)})`
	);
}

// ── Gestures ─────────────────────────────────────────────────────────────────

/**
 * A replace island steps over as ONE atomic unit, so the exact far/near offsets are the
 * load-bearing assertion; a zero-width widget island is transparent and the caret crosses
 * onto the adjacent real byte. Either way the source must be byte-identical after.
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
			throw new Error(`[${ctx.label}] a step-over arrow selected the replace island`);
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
				`[${ctx.label}] widget island trapped the caret at offset ${after} (island offset ${start})`
			);
		}
		if ((await page.locator(SELECTED).count()) !== 0) {
			throw new Error(`[${ctx.label}] arrowing across the widget island selected it`);
		}
	}

	await assertUnchanged(ctx, before, 'island walk');
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * Two-press select-then-delete, then undo — net identity. The assertion with teeth is on the
 * FIRST press: it selects the island whole and must leave the hidden bytes byte-identical,
 * so a silent one-byte eat fails here rather than hiding inside the delete.
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
			`[${ctx.label}] edgeDeleteReplaceIsland needs a replace island in ${blockIndex}`
		);
	}
	const before = await editor.bridge.getSource();
	const edge = key === 'Backspace' ? end : start;
	await arrowRightToOffset(ctx, blockIndex, edge);

	await page.keyboard.press(key);
	await editor.waitForRenderFlush();
	if ((await page.locator(SELECTED).count()) !== 1) {
		throw new Error(`[${ctx.label}] first ${key} did not select the replace island whole`);
	}
	if ((await editor.bridge.getSource()) !== before) {
		throw new Error(
			`[${ctx.label}] first ${key} changed the source — the hidden bytes must survive until the ` +
				`second press.\nBEFORE: ${JSON.stringify(before)}`
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
 * The island is transparent, so the press eats the ADJACENT real byte — never a no-op that
 * strips only the island DOM. The widget sits at its sentinel word's leading edge, so the
 * eaten byte is the space before it and the word survives to re-derive the island.
 */
export async function backspaceThroughWidgetIsland(
	ctx: SimContext,
	blockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, kind } = await readIsland(ctx, blockIndex);
	if (kind !== 'widget') {
		throw new Error(
			`[${ctx.label}] backspaceThroughWidgetIsland needs a widget island in ${blockIndex}`
		);
	}
	const before = await editor.bridge.getSource();
	if (start === 0) throw new Error(`[${ctx.label}] widget island at offset 0 has no adjacent byte`);

	await arrowRightToOffset(ctx, blockIndex, start);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await islandCount(ctx, blockIndex)) !== 1) {
		throw new Error(`[${ctx.label}] the widget island vanished after the transparent backspace`);
	}

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * Net identity. The insert lands adjacent to the island, whose content key is untouched, so
 * the island re-derives and the count holds across the edit.
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
			`[${ctx.label}] an adjacent insert perturbed the island count in ${blockIndex}`
		);
	}

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(before);
}

/**
 * The block decoration is source-keyed on content, so the badge must FOLLOW the bytes to the
 * new path and back. The treatment-follows-path contract itself is e2e-pinned; this drives
 * the interleave under load.
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
			{ timeout: 2000, polling: 16 }
		)
		.catch(() => {
			throw new Error(`[${ctx.label}] ${what}: badge presence at ${blockIndex} was not ${present}`);
		});
}

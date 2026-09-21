import { type SimContext } from '../invariants';
import { arrowRightToOffset } from './caret-walk';

// Gestures for the decoded-entity widget. It shows the character, not the reference it came
// from, so the expected answer's "typed at the end" rule can predict neither an insert in the
// middle of a sentence nor a delete of the whole reference: both wait for the widget and resync.

const ENTITY = '.md-entity-widget';

async function entitySpan(ctx: SimContext, blockIndex: number): Promise<{ end: number }> {
	const span = await ctx.page.evaluate((i) => {
		const host = document.querySelector(`[data-block-path='${JSON.stringify([i])}']`);
		const widget = host?.querySelector('.md-entity-widget');
		return widget ? { end: Number(widget.getAttribute('data-source-end')) } : null;
	}, blockIndex);
	if (!span || !Number.isInteger(span.end)) {
		throw new Error(`[${ctx.label}] no entity widget in block ${blockIndex}`);
	}
	return span;
}

/**
 * The caret is placed through the Selection API for setup only; the reference itself is typed
 * one key at a time, so the widget appears on the closing `;`.
 */
export async function typeEntityWidget(
	ctx: SimContext,
	blockIndex: number,
	offset: number,
	reference: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(ENTITY).count();

	await editor.focusBlockAtPath([blockIndex], offset);
	await editor.typeSlowly(reference);
	await page.locator(ENTITY).nth(glyphsBefore).waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceContains(reference);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * `deleteGranularity: 'atomic'` removes the whole reference in one press and one undo entry.
 * The caret reaches its trailing edge by real arrow presses, so the delete takes that path.
 */
export async function atomicDeleteEntityWidget(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await entitySpan(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(ENTITY).count();

	await arrowRightToOffset(ctx, blockIndex, end);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await page.locator(ENTITY).count()) !== glyphsBefore - 1) {
		throw new Error(`[${ctx.label}] the atomic backspace did not remove exactly one entity glyph`);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

import { type SimContext } from '../invariants';

// Directive gestures for the `:::name` primitive (plugins route only). Each gates on an
// observable promotion or widget swap and RESYNCS around the reparse — never predicts across
// a mount boundary, where a promotion or widget swap desyncs a char count.
//
// Container inserts are NOT here: a multi-line fence never forms from live single-block
// typing, since the block opener declines an unterminated fence to a paragraph.

const TEXT_WIDGET = '.directive-text-widget';
const LEAF = '.directive-leaf[contenteditable="true"]';

/**
 * The widget renders its source verbatim-but-dimmed, so the string is present the instant it
 * is typed — the mount signal is the widget COUNT rising, not a new substring. Recognition is
 * render-time, so the widget appears once the closing `]` lands.
 */
export async function insertTextDirective(
	ctx: SimContext,
	name: string,
	label: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetsBefore = await page.locator(TEXT_WIDGET).count();

	await editor.typeSlowly(`:${name}[${label}]`);
	await page.locator(TEXT_WIDGET).nth(widgetsBefore).waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The shared reveal→edit→commit UX (widget-interaction.ts). The source is dimmed-but-present
 * in both states, so the widget COUNT is the only reveal signal. The edit is suppressed from
 * the CST until blur, so settling on the source delta before the commit races the reveal DOM.
 */
export async function revealEditTextDirective(
	ctx: SimContext,
	stepIn: number,
	text: string,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetsBefore = await page.locator(TEXT_WIDGET).count();

	await page.locator(TEXT_WIDGET).first().click();
	await waitForWidgetCount(ctx, widgetsBefore - 1);
	for (let i = 0; i < stepIn; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);

	await editor.clickBlock(blurBlockIndex);
	await page.locator(TEXT_WIDGET).first().waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Promotion fires MID-typing the instant `::n` matches the opener, remounting the block at
 * the new kind, so predicting across it would desync the char count. Settles on the leaf
 * materializing and resyncs.
 */
export async function insertLeafDirective(
	ctx: SimContext,
	name: string,
	info: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const leavesBefore = await page.locator(LEAF).count();

	await editor.typeSlowly(`::${name} ${info}`);
	await editor.bridge.waitForSourceContains(`::${name} ${info}`);
	await waitForLeafCount(ctx, leavesBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The whole leaf line is one editable coordinate space, so this grows the leaf raw without
 * touching its kind. Settles on the source delta and resyncs.
 */
export async function editLeafInfo(
	ctx: SimContext,
	leafIndex: number,
	text: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(leafIndex);
	await page.keyboard.press('End');
	await page.keyboard.type(text);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * A directive leaf is `not-mergeable`, so the walk must move focus rather than concatenate.
 * Confirms byte-identity by a positive RE-READ after the settle window — absence of mutation
 * cannot be waited for as a delta.
 */
export async function leafBackspaceAtStart(ctx: SimContext, leafIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(leafIndex);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await editor.waitForNoSourceMutation();

	const after = await editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`[${ctx.label}] directive leaf merged on Backspace-at-start (not-mergeable violated).\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	tracker.resync(after);
}

/**
 * The opaque container rebuilds its own raw from the edited children, so the edit lands
 * mid-document, never the end-of-doc append the tracker predicts — settle and resync.
 */
export async function editContainerBody(
	ctx: SimContext,
	bodyPath: number[],
	text: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlockAtPath(bodyPath, 0);
	await page.keyboard.press('End');
	await page.keyboard.type(text);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

// ── Internal ────────────────────────────────────────────────────────────────

function waitForWidgetCount(ctx: SimContext, count: number): Promise<void> {
	return waitForNodeCount(ctx, TEXT_WIDGET, count);
}

function waitForLeafCount(ctx: SimContext, count: number): Promise<void> {
	return waitForNodeCount(ctx, LEAF, count);
}

async function waitForNodeCount(ctx: SimContext, selector: string, count: number): Promise<void> {
	await ctx.page.waitForFunction(
		({ sel, n }) => document.querySelectorAll(sel).length === n,
		{ sel: selector, n: count },
		{ timeout: 2000, polling: 16 }
	);
}

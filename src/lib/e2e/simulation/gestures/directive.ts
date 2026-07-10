import { type SimContext } from '../invariants';

// Directive gestures for the `:::name` primitive (plugins route only). Free
// functions taking `ctx` first so the Gestures class delegates without growing its
// frozen surface, mirroring gestures/math.ts. Each drives real keyboard/mouse,
// gates on an observable promotion/widget swap, then resyncs the tracker around the
// reparse the editor performs — never predicts across a mount boundary, where a
// paragraph→leaf promotion or a `:name[…]`→widget swap desyncs a char count.
//
// Container inserts are NOT here: a multi-line `:::name … :::` fence never forms
// from live single-block typing (the block opener declines an unterminated fence to
// a paragraph), so the spec inserts one by pasting a copied container — a real
// clipboard action composed from the existing selection gestures.

const TEXT_WIDGET = '.directive-text-widget';
const LEAF = '.directive-leaf[contenteditable="true"]';

/**
 * Type `:name[label]` at the caret (a prose block), promoting the span to an atomic
 * text widget. Recognition is render-time, so the widget mounts once the closing
 * `]` lands; the caret stays in the host paragraph, so a caller may keep editing
 * after. The widget renders its source verbatim-but-dimmed, so the source string is
 * present the instant it is typed — the mount is the widget COUNT rising, not a new
 * substring. Resyncs around the recompute rather than predicting per char.
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
 * Click the first text widget to reveal its source, step `stepIn` chars past the
 * `:name[` opener into the label, insert `text`, and commit by blurring onto
 * `blurBlockIndex` — the shared reveal→edit→commit UX (widget-interaction.ts, reused
 * from inline math). Reveal drops the widget COUNT (the source is dimmed-but-present
 * in both states, so count is the only reveal signal); commit re-forms it. The edit
 * is suppressed from the CST until blur, so the source delta appears only after the
 * commit — settling on it before would race the ephemeral reveal DOM.
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
 * Type `::name info` on an empty line at column 0, promoting the paragraph to a
 * directive leaf. Promotion fires mid-typing the instant `::n` matches the opener,
 * remounting the block at the new kind; the editor re-focuses at the post-edit
 * offset, so the trailing chars land in the leaf. Settles on the leaf materializing
 * (a new editable `.directive-leaf` plus the fence in the source) and resyncs —
 * predicting across the promotion would desync the char count.
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
 * Click the leaf at `leafIndex`, jump to end-of-line, and type `text` into its info
 * — the whole line is one editable coordinate space, so this is an in-place edit
 * that grows the leaf raw without touching its kind. Settles on the source delta and
 * resyncs.
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
 * Backspace at the start of the leaf at `leafIndex`. A directive leaf is
 * `not-mergeable`, so the merge walk must move focus rather than concatenate into
 * the block above — a real corruption would collapse the two blocks and rewrite the
 * source. Settles by confirming the source is byte-identical (absence-of-mutation
 * needs a positive re-read after the settle window, not a delta wait) and fails loud
 * if a merge slipped through.
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
 * Click the container body child at `bodyPath`, jump to end-of-line, and type
 * `text`. The opaque container rebuilds its own raw from the edited children, so the
 * edit lands mid-document (never the end-of-doc append the tracker predicts) —
 * settle on the observed source delta and resync, the predict/resync split every
 * plugin-container edit uses.
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

import { type SimContext } from '../invariants';
import { waitForNodeCount } from './node-count';

// Directive gestures for the `:::name` syntax (plugins route only). Each waits for the block
// to change kind or for the widget to swap in, then resyncs after the reparse; predicting
// across either would put the character count out.
//
// Inserting a container is not here: typing one block at a time never builds a multi-line
// fence, since the parser reads an unfinished fence as a paragraph.

const TEXT_WIDGET = '.directive-text-widget';
const LEAF = '.directive-leaf[contenteditable="true"]';

/**
 * The widget shows its source as typed, only dimmed, so the text is there from the moment it is
 * typed: what marks the widget arriving is the widget count rising, not new text. It is
 * recognised when rendering, so the widget appears once the closing `]` is typed.
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
 * The shared show-edit-commit behaviour (widget-interaction.ts). The source is present in both
 * states, only dimmed, so the widget count is the one sign it opened. The edit is kept out of
 * the tree until blur, so waiting for the source to change before the commit would race the DOM.
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
	await waitForNodeCount(ctx, TEXT_WIDGET, widgetsBefore - 1);
	for (let i = 0; i < stepIn; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);

	await editor.clickBlock(blurBlockIndex);
	await page.locator(TEXT_WIDGET).first().waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The block changes kind while typing, the moment `::n` matches the opener, and remounts, so
 * predicting across that would put the character count out. Waits for the new block to appear
 * and resyncs.
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
	await waitForNodeCount(ctx, LEAF, leavesBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The whole line is one editable stretch of text, so this lengthens the block's raw text
 * without changing its kind. Waits for the source to change and resyncs.
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
 * A directive block is `not-mergeable`, so Backspace moves the focus instead of joining it to
 * the block above. The bytes are checked by reading the source again once the editor has
 * recorded its decision about the key: nothing changing cannot be waited for.
 */
export async function leafBackspaceAtStart(ctx: SimContext, leafIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(leafIndex);
	await page.keyboard.press('Home');
	await editor.pressDeclined('Backspace');

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
 * The opaque container rebuilds its own raw text from the edited children, so the edit lands
 * mid-document rather than at the end, which is all the expected answer can predict. Waits for
 * the change and resyncs.
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

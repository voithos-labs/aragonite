import { type SimContext } from '../invariants';
import { waitForNodeCount } from './node-count';

// Directive gestures for the `:::name` syntax (plugins route only). Each waits for the block to
// change kind or for the widget to swap in, then resyncs, since predicting across either would
// miscount. No gesture types a container: the parser reads an unfinished fence as a paragraph.

const TEXT_WIDGET = '.directive-text-widget';
const LEAF = '.directive-leaf[contenteditable="true"]';

/** The widget shows its source dimmed, so the text is there as it is typed and the widget count
 *  rising on the closing `]` is what marks the widget arriving. */
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

/** The source shows in both states, so the widget count is the one sign it opened; the edit stays
 *  out of the tree until blur, so a source wait before the commit would race the DOM. */
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

/** The block changes kind and remounts the moment `::n` matches the opener, so this waits for
 *  the new block and resyncs rather than predicting. */
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

/** The whole line is one editable run, so this lengthens the raw text without changing kind. */
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

/** A directive block is `not-mergeable`, so Backspace moves focus instead of joining; the source
 *  is read again once the editor has recorded its decision about the key. */
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

/** The opaque container rebuilds its raw text from its children, so the edit lands mid-document,
 *  where the expected answer cannot predict it. */
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

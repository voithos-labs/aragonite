import { type SimContext } from '../invariants';

// The slash list (the slash-commands plugin, `/test/editor?slash=on`). A pick removes the typed
// `/query` and inserts the block through the paste path, which the expected answer cannot
// predict, so the gesture waits for the block's bytes and resyncs.

const SLASH_MENU = '[data-inline-menu="slash-commands"]';

/**
 * Types `/query` on the empty line, picks the first row with Enter, then types `text`. `inserted`
 * is the new block's opening bytes, which must replace the query ahead of `text`.
 */
export async function slashInsert(
	ctx: SimContext,
	query: string,
	inserted: string,
	text: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const typed = `/${query}`;
	await editor.typeSlowly(typed);
	await page.locator(SLASH_MENU).waitFor({ state: 'visible' });
	await page.keyboard.press('Enter');
	await page.locator(SLASH_MENU).waitFor({ state: 'hidden' });
	await editor.bridge.waitForSource(
		(source) => source.includes(inserted) && !source.includes(typed)
	);
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(inserted + text);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

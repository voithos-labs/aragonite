import { type SimContext } from '../invariants';

// The slash list (the slash-commands plugin, `/test/editor?slash=on`). A pick removes the typed
// `/query` and inserts the block through the paste path, which the expected answer cannot
// predict, so the gesture waits for the block's bytes and resyncs.

const SLASH_MENU = '[data-inline-menu="slash-commands"]';

/**
 * Types `/query` a key at a time on the empty line the caret is on, picks the list's first row
 * with Enter, then types `text` into the new block. `inserted` is the block's opening bytes, which
 * the source must hold, followed by `text`, in place of the query.
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

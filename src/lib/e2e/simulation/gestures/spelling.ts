import { type SimContext } from '../invariants';
import { textRunRect } from '../../text-runs';

// The spellcheck package's rows (`/test/editor?spell=on`). The dictionary picks the replacement,
// which the expected answer cannot predict, so the pick waits for the bytes and resyncs.

/** Right-clicks the first painted run of `word`, picks the first row the menu leads with, and
 *  returns the word it wrote. */
export async function pickSpelling(ctx: SimContext, word: string): Promise<string> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const r = await textRunRect(page, word);
	const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	await page.mouse.click(point.x, point.y, { button: 'right' });
	const first = page.getByRole('menu').getByRole('menuitem').first();
	const written = (await first.textContent())!.trim();
	await first.click();
	await editor.bridge.waitForSource((source) => source !== before && source.includes(written));
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
	return written;
}

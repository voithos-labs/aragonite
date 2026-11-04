/**
 * A finger on a touch screen, the one way an e2e spec drags one: Playwright's touchscreen only
 * taps, so a drag is sent as Chromium's CDP touch events. A spec using it sets `hasTouch`.
 */
import type { Page } from '@playwright/test';
import { EditorPage } from './editor-page';
import { skipUnlessSupported } from './browser-engine';
import type { Point } from './text-runs';

/** Three short paragraphs, and a range across the first two, for a spec to build its document on. */
export const PARAGRAPHS = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n\n';
export const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };

/** The editor with `doc` loaded, or the test skipped on an engine with no touch or no CDP. */
export async function openTouch(page: Page, doc: string): Promise<EditorPage> {
	skipUnlessSupported(page, 'touch');
	skipUnlessSupported(page, 'cdp');
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(doc);
	return editor;
}

export interface FingerDragOptions {
	/** The moves between press and lift, evenly spaced. */
	steps?: number;
	/** Runs after the last move, before the finger lifts. */
	held?: () => Promise<void>;
	/** How the touch ends: lifted, or cancelled as a browser cancels one it takes for a scroll. */
	end?: 'touchEnd' | 'touchCancel';
}

/** A finger pressed at `from`, moved in a straight line to `to`, then lifted. */
export async function fingerDrag(
	page: Page,
	from: Point,
	to: Point,
	{ steps = 8, held, end = 'touchEnd' }: FingerDragOptions = {}
): Promise<void> {
	const at = (step: number) => [
		{
			x: Math.round(from.x + ((to.x - from.x) * step) / steps),
			y: Math.round(from.y + ((to.y - from.y) * step) / steps)
		}
	];
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
	for (let step = 1; step <= steps; step++) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
	}
	await held?.();
	await cdp.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
	await cdp.detach();
}

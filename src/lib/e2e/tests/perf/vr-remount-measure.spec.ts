import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { spacerCount } from './vr-helpers';

// A block that remounts at the height it was measured at costs the scroll nothing: the batch
// reads it after the flush that mounted it, so no transient empty host ever reaches the model
// and no correction has to be undone a frame later. Requirements:
// e2e/requirements/perf/vr-remount-measure.md.

const SECTIONS = 40;
// A tall inline construct: the rendered fraction raises the line box, so the paragraph's height
// with its widgets differs from its height without them whatever the wrap.
const LONG = (i: number) =>
	`Section ${i} holds the ratio $\\frac{H_{${i}}}{E_{${i}}}$ beside the pair $\\frac{\\xi_{${i}}}{\\eta_{${i}}}$ in one line.`;
const HEAVY = Array.from({ length: SECTIONS }, (_, i) =>
	[
		`## Section ${i}`,
		LONG(i),
		`> ${LONG(i)}\n>\n> ${LONG(i)}`,
		'```js',
		`function section${i}() {\n\tconst rows = [];\n\tfor (let k = 0; k < ${i}; k++) rows.push(k * 2);\n\treturn rows;\n}`,
		'```',
		`- item one of ${i}`,
		`- item two of ${i}`
	].join('\n\n')
).join('\n\n');

const WHEEL_TICKS = 30;
const WHEEL_TICK_PX = 320;

/** Every programmatic write to the editor's own scrollTop, counted at its setter: the scroll
 *  correction is the only writer while the pointer drives the wheel. */
async function countScrollWrites(page: Page): Promise<void> {
	await page.evaluate(() => {
		const editor = document.querySelector('.editor') as HTMLElement;
		const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
		(window as any).__scrollWrites = 0;
		Object.defineProperty(editor, 'scrollTop', {
			get() {
				return desc.get!.call(this);
			},
			set(v: number) {
				(window as any).__scrollWrites++;
				desc.set!.call(this, v);
			},
			configurable: true
		});
	});
}

function scrollWrites(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__scrollWrites as number);
}

function editorScrollTop(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

async function wheel(page: Page, editor: EditorPage, ticks: number, px: number): Promise<void> {
	for (let i = 0; i < ticks; i++) {
		const before = await editorScrollTop(page);
		await page.mouse.wheel(0, px);
		await expect.poll(() => editorScrollTop(page)).not.toBe(before);
		await editor.waitForRenderFlush();
	}
}

test('wheeling back up over measured blocks writes the scroll never', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	// The plugins route renders the inline math; source mode, so no flip is in play.
	await page.goto('/test/plugins');
	await page.waitForFunction(() => (window as any).__test !== undefined);
	const editor = new EditorPage(page);
	await editor.loadContent(HEAVY);
	await editor.waitForRenderFlush();
	expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);

	const box = (await editor.editorContainer.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await countScrollWrites(page);

	// Down: first mounts, estimates replaced by measurements below the anchor, no writes.
	await wheel(page, editor, WHEEL_TICKS, WHEEL_TICK_PX);
	expect(await scrollWrites(page), 'writes on the way down').toBe(0);

	// Up: every block re-entering above the anchor was measured on the way down, so a write
	// here is a transient height that reached the model.
	await wheel(page, editor, WHEEL_TICKS, -WHEEL_TICK_PX);
	expect(await scrollWrites(page), 'writes on the way up').toBe(0);
	expect(pageErrors).toEqual([]);
});

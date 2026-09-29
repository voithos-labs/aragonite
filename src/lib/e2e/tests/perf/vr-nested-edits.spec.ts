import { test, expect } from '../../fixtures';
import { capturePageErrors } from '../../page-probes';
import { spacerCount } from './vr-helpers';
import {
	BELOW,
	CONTAINER,
	docWith,
	listOf,
	openNested,
	quoteOf,
	settleAll
} from './vr-nested-fixtures';

// A change inside a container that holds the viewport's top, whatever makes it, is corrected
// with one scroll write: the block you're looking at stays put.
// Requirements: e2e/requirements/perf/vr-nested-edits.md.

test.use({ viewport: { width: 1000, height: 700 } });

const LONG =
	'with a good many more words in it, so that it wraps onto another line or two when the column narrows.';

// ── A window resize ─────────────────────────────────────────────────────────

const WIDE_PARAGRAPHS = (doc: string) =>
	doc.replace(/fill most of a line\./g, `fill most of a line ${LONG}`);

const RESIZED = [
	{
		name: 'a 40-paragraph blockquote',
		container: quoteOf(40, `Quoted paragraph 1 ${LONG}`, LONG),
		top: [CONTAINER, 6]
	},
	{
		name: 'a 40-item list',
		container: Array.from(
			{ length: 40 },
			(_, i) => `- item ${i} ${LONG}\n\n  a second block ${LONG}`
		).join('\n'),
		top: [CONTAINER, 6, 0]
	}
];

// Self mode only: under host scroll a width change trips a ResizeObserver loop error through the
// editor's width watcher, whatever the container holds.
for (const { name, container, top } of RESIZED) {
	test(`narrowing the window with ${name} holding the top`, async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		const nested = await openNested(page, 'self', WIDE_PARAGRAPHS(docWith(container)));
		expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);
		await nested.topInside(top);
		const before = (await nested.screenTop(top))!;
		const writes = await nested.countWrites();

		await page.setViewportSize({ width: 640, height: 700 });
		await settleAll(nested.editor);

		const after = await nested.screenTop(top);
		expect(after, `${JSON.stringify(top)} stays mounted`).not.toBeNull();
		expect(Math.abs(after! - before), `moved from ${before} to ${after}`).toBeLessThanOrEqual(1);
		// The rebuild's correction, then the estimate error of blocks the new width mounts.
		const written = await writes();
		expect(written.length, `at most two scroll writes: ${written}`).toBeLessThanOrEqual(2);
		expect(pageErrors).toEqual([]);
	});
}

// ── Typing into a block above the top ───────────────────────────────────────

const TYPED = Array.from({ length: 70 }, () => 'typed words').join(' ');

test('typing into a block above the top of a 40-paragraph blockquote holding it', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const nested = await openNested(page, 'self', docWith(quoteOf(40, 'Quoted one.')));
	await nested.topInside([CONTAINER, 1]);
	await nested.editor.focusBlockAtPath([CONTAINER, 1], 3);
	await nested.topInside([CONTAINER, 6]);
	const before = (await nested.screenTop([CONTAINER, 6]))!;
	const writes = await nested.countWrites();

	await page.keyboard.insertText(TYPED);
	await settleAll(nested.editor);

	expect(Math.abs((await nested.screenTop([CONTAINER, 6]))! - before)).toBeLessThanOrEqual(1);
	expect(await writes(), 'one scroll write').toHaveLength(1);
	expect(pageErrors).toEqual([]);
});

test('typing into a block above the top inside a list holding it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const nested = await openNested(page, 'self', docWith(listOf(10, 1, 'a second block')));
	const typedIn = [CONTAINER, 1, 1];
	await nested.topInside(typedIn);
	await nested.editor.focusBlockAtPath(typedIn, 3);
	await nested.topInside([CONTAINER, 6, 0]);
	const grownFrom = await nested.contentBox(typedIn);
	const writes = await nested.countWrites();

	await page.keyboard.insertText(TYPED);
	await settleAll(nested.editor);

	const grownTo = await nested.contentBox(typedIn);
	const growth = grownTo!.bottom - grownTo!.top - (grownFrom!.bottom - grownFrom!.top);
	expect(growth, 'the typing re-wraps the block').toBeGreaterThan(100);
	// The editor's own writes: the browser moves this scroll by itself too, before the correction.
	const written = await writes();
	expect(written, 'one scroll write').toHaveLength(1);
	expect(Math.abs(written[0] - growth), `wrote ${written[0]} for ${growth}`).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});

// ── A structural edit from the keyboard ─────────────────────────────────────

// Enter at a block's start leaves the empty half in place under its id and moves the text down a
// slot, so the block the round holds is the one at the top, and the page stays where it was.
test('Enter at the start of the block holding the top of a 10-paragraph blockquote', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const nested = await openNested(page, 'self', docWith(quoteOf(10, 'Quoted one.')));
	const held = [CONTAINER, 6];
	await nested.topInside(held);
	await nested.editor.focusBlockAtPath(held, 0);
	const before = (await nested.screenTop(held))!;
	const below = (await nested.screenTop([BELOW]))!;
	const writes = await nested.countWrites();

	await page.keyboard.press('Enter');
	await settleAll(nested.editor);

	expect(Math.abs((await nested.screenTop(held))! - before)).toBeLessThanOrEqual(1);
	const added = (await nested.screenTop([CONTAINER, 7]))! - before;
	expect(added, 'the text moved down one empty block').toBeGreaterThan(10);
	expect(Math.abs((await nested.screenTop([BELOW]))! - below - added)).toBeLessThanOrEqual(1);
	expect(await writes(), 'no scroll write').toEqual([]);
	expect(pageErrors).toEqual([]);
});

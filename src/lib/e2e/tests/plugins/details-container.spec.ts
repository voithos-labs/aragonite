import { test, expect } from '../../fixtures';
import {
	DetailsPage,
	readDetails,
	activeBlockPath,
	bodyHostCount,
	capturedErrors,
	OPEN,
	SUMMARY_ONLY,
	CLOSED_WITH_BELOW,
	OPEN_WITH_BELOW
} from './details-helpers';

/**
 * WS-B Cycle 2 — the `<details>` collapsible, the second reserved-chrome
 * consumer. Collapse is a windowing clamp: closed ⇒ only the summary row
 * mounts, every body child genuinely unmounts. This gate proves the toggle
 * (open metadata ↔ opener bytes), the clamp's mount/unmount, and the three
 * decided caret rules — asserted against the CST by path, the serialized
 * bytes, and the mounted body-host count.
 */
test.describe('plugin container: <details> collapsible', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('substrate: ?seed=details mounts the DetailsBlock component, not a raw fallback', async ({
		page
	}) => {
		const d = await readDetails(page, 0);
		expect(d.kind).toBe('details');
		expect(d.childKinds).toEqual(['details-summary', 'paragraph']);
		await expect(page.locator('.details-block')).toBeVisible();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('toggle round-trips the opener bytes and the body mount state', async ({ page }) => {
		await editor.loadContent(OPEN);
		expect(await bodyHostCount(page)).toBe(2); // summary + body

		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		expect(await bodyHostCount(page)).toBe(1); // body genuinely unmounted
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		expect(await editor.bridge.getSource()).toBe(
			'<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n'
		);

		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details open>');
		expect(await bodyHostCount(page)).toBe(2); // body remounted
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo after a collapse restores the opener bytes and remounts the body', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		expect(await bodyHostCount(page)).toBe(1);

		await editor.undo();
		await editor.bridge.waitForSourceContains('<details open>');
		expect(await bodyHostCount(page)).toBe(2);
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('collapsing with the caret in the body lands the caret on the summary', async ({ page }) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		expect(await activeBlockPath(page)).toEqual([0, 1]);

		// Mouse toggle keeps the body caret (mousedown default suppressed); the clamp
		// kills the pin, so the commit's afterTick moves the orphaned caret up.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('M3: Enter in a collapsed summary-only details mints nothing and pushes no undo entry', async ({
		page
	}) => {
		await editor.loadContent(SUMMARY_ONLY);
		expect((await readDetails(page, 0)).childCount).toBe(1); // summary only, no body

		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('<summary>SumX</summary>');
		await editor.waitForUndoBatchFlush();

		await page.keyboard.press('Enter');
		await editor.waitForNoSourceMutation();
		// The gate consumed Enter: no body minted, caret stays in the summary.
		expect((await readDetails(page, 0)).childCount).toBe(1);
		expect(await activeBlockPath(page)).toEqual([0, 0]);

		// Enter pushed no undo entry: the single undo reverts the 'X' typing, not a
		// phantom mint (which would leave 'X' behind).
		await editor.undo();
		await editor.bridge.waitForSourceContains('<summary>Sum</summary>');
		expect((await readDetails(page, 0)).childCount).toBe(1);
		expect(await editor.bridge.getSource()).toBe(SUMMARY_ONLY);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('arrow-walk up from below into a collapsed details lands on the summary', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		expect(await bodyHostCount(page)).toBe(1); // body clamped out
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		await page.keyboard.press('ArrowUp');
		// The clamped-out last child can't receive focus; the walk must land on the
		// summary, not silently no-op.
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('horizontal walk (ArrowLeft) from below into a collapsed details lands on the summary', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// ArrowLeft at a block start routes through `focus(CURSOR_END)`, which targets
		// the (unmounted) last child — the exact clamp path §4 flags. It must clamp to
		// the summary, not no-op on the absent ref.
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('ArrowDown from a collapsed summary exits below the container', async ({ page }) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		expect(await bodyHostCount(page)).toBe(1); // body clamped out
		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"

		// The move targets the unmounted body child; it must delegate past the
		// container to "Below", not silently dead-end on the absent ref.
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => activeBlockPath(page)).toEqual([1]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('ArrowRight at the end of a collapsed summary exits below the container', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => activeBlockPath(page)).toEqual([1]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace below a collapsed details does not merge into the hidden body', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// The cross-boundary merge walk must not write into the clamped-out body:
		// no mutation, caret to the summary end (the interior not-mergeable-title
		// rule, mirrored across the container boundary).
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(CLOSED_WITH_BELOW);
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		await expect(page.getByText('Below')).toBeVisible();

		// Typing appends at "Sum|" — the live-caret proof the focus-move landed at
		// the summary's END, not its start.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('<summary>SumX</summary>');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace below an OPEN details merges into the last body child', async ({ page }) => {
		await editor.loadContent(OPEN_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// The collapse probe must not over-fire: an open details keeps the normal
		// deep-leaf merge, "Below" joining "Body" with the caret at the join point.
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('BodyBelow');
		expect(await editor.bridge.getSource()).toBe(
			'<details open>\n<summary>Sum</summary>\n\nBodyBelow\n\n</details>\n'
		);
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 1]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('summary editing round-trips and Enter descends into the body (inherited chrome)', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 0], 7); // end of "Summary"
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('<summary>SummaryZ</summary>');
		expect((await readDetails(page, 0)).childKinds[0]).toBe('details-summary');

		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 1]);
		await editor.typeText('q');
		await editor.bridge.waitForSourceContains('qBody');
		expect((await readDetails(page, 0)).childTexts).toEqual(['SummaryZ', 'qBody']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	// The terminator has no fence length to escalate, so the commit path escapes it
	// instead: the bytes that land are `&lt;/details>`, which reads as the literal
	// tag in the editor and on GitHub while closing neither.
	test('typing the terminator into the body escapes it, keeping the container whole', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 2]);

		await editor.typeSlowly('</details>');
		await editor.bridge.waitForSourceContains('&lt;/details>');

		// Still ONE details holding the typed line, and the line is still prose —
		// the escape runs ahead of the reparse that picks the kind.
		const d = await readDetails(page, 0);
		expect(d.kind).toBe('details');
		expect(d.childKinds).toEqual(['details-summary', 'paragraph', 'paragraph']);
		expect(await page.locator('.details-block .block-host').last().innerText()).toBe('</details>');

		// The caret sits after the typed `>`, past the entity the escape grew ahead of
		// it, so the next keystroke continues the line instead of landing mid-word.
		//
		// KEEP THE OFFSET. This assertion is the ONLY guard on the commit doors' caret
		// mapping: a unit pin would need jsdom plus mounted refs, since the landing goes
		// through `refAt(i)?.focus`. Weakened to a path check it guards nothing, and the
		// caret silently lands three units inside the word — the shipped bug it caught.
		const sel = await page.evaluate(() => (window as any).__test.getSelectionPaths());
		expect(sel.focus).toEqual({ path: [0, 2], offset: 13 });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a cross-block copy ending mid-summary pastes back as a real details, open flag intact', async ({
		page
	}) => {
		await editor.loadContent(
			'Above\n\n<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n\nBelow\n'
		);

		// Drag-select from the prose above into the middle of the summary, then copy.
		await editor.dragFromTo([0], 2, [1, 0], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		// Paste into "Below": the synthesized closer makes the bytes reparse to a
		// second `<details>` carrying the truncated summary and the live open flag.
		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await page.keyboard.press('End');
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('<summary>Sum</summary>');

		const pasted = await page.evaluate(() => {
			const notes = (window as any).__test
				.getDocument()
				.children.filter((c: { kind: string }) => c.kind === 'details');
			return { count: notes.length, lastRaw: notes[notes.length - 1]?.raw ?? '' };
		});
		expect(pasted.count).toBe(2);
		expect(pasted.lastRaw).toContain('<details open>');
		expect(await capturedErrors(page)).toEqual([]);
	});
});

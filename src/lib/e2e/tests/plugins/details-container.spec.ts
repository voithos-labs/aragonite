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
 * The `<details>` collapsible, the second block with an editable title row. Collapsing clamps the
 * window: closed, only the summary row mounts and every body child really unmounts. These tests
 * cover the toggle (open metadata against the opener bytes), the clamp mounting and unmounting,
 * and the three caret rules, checked against the CST by path, the serialized bytes, and how many
 * body hosts are mounted.
 */
test.describe('plugin container: <details> collapsible', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
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

		// The mouse toggle keeps the body caret, since mousedown's default is suppressed, and the
		// clamp then unmounts that block, so the toggle's commit puts the caret on the summary.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the collapse puts the caret on the summary once, and typing lands there', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		await page.evaluate(() => {
			const w = window as unknown as { focusIns: number };
			w.focusIns = 0;
			document.addEventListener('focusin', () => w.focusIns++);
		});

		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		await editor.waitForRenderFlush();
		expect(await page.evaluate(() => (window as unknown as { focusIns: number }).focusIns)).toBe(1);
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceContains('<summary>xSummary</summary>');
	});

	test('a caret put back into a closed body lands on the title row and opens nothing', async ({
		page
	}) => {
		await editor.loadContent(
			'Above\n\n<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n'
		);
		await editor.focusBlockAtPath([0], 0);
		// Select-all twice covers the hidden body, so collapsing to the end aims into it.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await page.keyboard.type('x');

		const closed = 'Above\n\n<details>\n<summary>Sumx</summary>\n\nHidden\n\n</details>\n';
		await editor.bridge.waitForSource((source) => source === closed);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('M3: Enter in a collapsed summary-only details creates nothing and pushes no undo entry', async ({
		page
	}) => {
		await editor.loadContent(SUMMARY_ONLY);
		expect((await readDetails(page, 0)).childCount).toBe(1); // summary only, no body

		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('<summary>SumX</summary>');
		await editor.waitForUndoBatchFlush();

		await editor.pressDeclined('Enter');
		// The check consumed Enter: no body block was created, and the caret stays in the summary.
		expect((await readDetails(page, 0)).childCount).toBe(1);
		expect(await activeBlockPath(page)).toEqual([0, 0]);

		// Enter pushed no undo entry: the one undo reverts the 'X' typing, not a block that was
		// never created, which would leave the 'X' behind.
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
		// The unmounted last child cannot take focus, so the move must land on the summary rather
		// than quietly doing nothing.
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('horizontal walk (ArrowLeft) from below into a collapsed details lands on the summary', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// ArrowLeft at a block start targets the last child through `focus(CURSOR_END)`, and that child
		// is unmounted, so the move must fall back to the summary.
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('ArrowDown from a collapsed summary exits below the container', async ({ page }) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		expect(await bodyHostCount(page)).toBe(1); // body clamped out
		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"

		// The move targets the unmounted body child, so it must carry on past the container to
		// "Below" rather than stop at the missing reference.
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

		// A merge across the container's edge must not write into the unmounted body: no edit, and the
		// caret to the summary's end, as with merging into a title from inside.
		await editor.pressDeclined('Backspace');
		expect(await editor.bridge.getSource()).toBe(CLOSED_WITH_BELOW);
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		await expect(page.getByText('Below')).toBeVisible();

		// Typing appends at "Sum|", the live-caret proof that the focus move landed at the
		// summary's end and not at its start.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('<summary>SumX</summary>');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace below an open details merges into the last body child', async ({ page }) => {
		await editor.loadContent(OPEN_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// The collapse check must not fire too widely: an open details keeps the ordinary merge
		// into its deepest block, with "Below" joining "Body" and the caret at the join.
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

	// The terminator has no fence length to escalate, so the commit path escapes it instead: the
	// bytes that land read as the literal tag in the editor and on GitHub while closing neither.
	test('typing the terminator into the body escapes it, keeping the container whole', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 2]);

		await editor.typeSlowly('</details>');
		await editor.bridge.waitForSourceContains('&lt;/details>');

		// Still one details holding the typed line, and the line is still prose, because the
		// escape runs before the reparse that picks the kind.
		const d = await readDetails(page, 0);
		expect(d.kind).toBe('details');
		expect(d.childKinds).toEqual(['details-summary', 'paragraph', 'paragraph']);
		expect(await page.locator('.details-block .block-host').last().innerText()).toBe('</details>');

		// The caret sits after the typed `>`, past the entity the escape grew. This offset is the only
		// check on how the commit paths map the caret; a path-only check would pass a wrong offset.
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
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		// Paste into "Below": the added closer makes the bytes reparse into a second `<details>`
		// holding the truncated summary and the live open flag.
		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await page.keyboard.press('End');
		await editor.paste();
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

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, extendTo, landAt } from './helpers';

// A block whose only bytes are its own markers has no content to stand behind them, so they
// paint: a caret can land on them and a typed byte goes after them. A destructive key at the
// block's own structure follows the mode; one at an inline construct follows what is painted.
// The checks are the source bytes, telling which side a typed byte landed on, and the marker's
// computed display.
// Requirements: e2e/requirements/presentation/presentation-live-opener-typing.md.

const OPENER = 0;
const TYPED = 1;

/** A bare `#` and an empty fence: the load half of the same class, with no typing at all. */
const LOADED = ['#', '', '```', '```', '', 'para'].join('\n') + '\n';

/** The empty fence alone at the top, the shape the language-chip spec drives the same way. */
const EMPTY_FENCE_FIRST = ['```', '```', '', 'para'].join('\n') + '\n';

/** A link with no text: five painted bytes, which no mode may treat as unseen. */
const EMPTY_LINK = '[](u)\n';

/** The same five bytes above a plain paragraph, so the join has a boundary to cross. */
const PAINTED_LINK_DOC = ['[](u)', '', 'para'].join('\n') + '\n';

/** Between `]` and `(`, inside the painted markers, where each rewrite could decline. */
const MID_CHROME = 2;

/** The same markers inside a construct that both cut paths do open. All nine bytes paint, and
 *  the caret reaches offset 2 only because they do. */
const WRAPPED_DOC = ['**[](u)**', '', 'para'].join('\n') + '\n';

/** Between the outer pair and the inner one. */
const INSIDE_PAIR = 2;

/** An empty paragraph below an existing one, made by the gesture that makes it in real use. */
async function emptyBlockBelow(page: Page, mode: 'live' | 'preview-inline'): Promise<EditorPage> {
	const ep = await enterPresentationMode(page, mode, 'lorem\n');
	await clickBlockSettled(ep, OPENER);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Enter');
	await ep.bridge.waitForBlockCount(2);
	return ep;
}

/** Wait for the typed bytes to land; where they landed is the assertion. */
async function typeSettled(ep: EditorPage, page: Page, text: string): Promise<void> {
	for (const ch of text) {
		const before = await ep.bridge.getSource();
		await page.keyboard.type(ch);
		await ep.bridge.waitForSourceWith((source, previous) => source !== previous, before);
		await ep.waitForRenderFlush();
	}
}

const markerOf = (ep: EditorPage, index: number) =>
	ep.getBlock(index).locator('.md-marker').first();

test.describe('live mode — a typed block opener paints until it has content', () => {
	test('typing `#` paints the marker the keystroke just minted', async ({ page }) => {
		const ep = await emptyBlockBelow(page, 'live');

		await typeSettled(ep, page, '#');

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
	});

	test('the next letter lands after the painted marker, not in front of it', async ({ page }) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '#');

		await typeSettled(ep, page, 'a');

		await expect.poll(() => ep.bridge.getBlockKind(TYPED)).toBe('paragraph');
		expect(await ep.bridge.getSource()).toContain('#a');
	});

	test('a space keeps the heading painted; the first content character folds it', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '#');

		await typeSettled(ep, page, ' ');
		expect(await ep.bridge.getSource()).toContain('# ');
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');

		await typeSettled(ep, page, 'a');
		expect(await ep.bridge.getSource()).toContain('# a');
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'none');
	});

	test('three backticks paint their fence line, and the info string appends after it', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');

		// Not `typeSettled`: the second backtick steps over the one auto-pairing added after the
		// first, so that keystroke changes no byte to wait on.
		await page.keyboard.type('```');
		await ep.bridge.waitForSourceContains('```');
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('fencedCode');

		// The completed fence offers its language picker; Enter writes the info string and
		// returns the caret to the body. A fence with a body line to sit on keeps its
		// backticks hidden, so the typed byte is the proof of where the caret went.
		const picker = page.locator('.code-lang-picker input');
		await expect(picker).toBeVisible();
		await page.keyboard.type('js');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('```js');
		await expect(ep.getBlock(TYPED).locator('.md-fence-line').first()).toHaveCSS('display', 'none');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('```js\nX');
	});

	// The demote reads the first offset the caret can reach, so painting the markers turns this
	// key into the marker-byte delete that source mode performs.
	test('Backspace inside a painted `# ` takes the marker byte and does not demote', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '# ');

		const before = await ep.bridge.getSource();
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceWith((source, previous) => source !== previous, before);

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
	});

	// The other end of the same key: raw 0 is reachable once the markers paint, and there one
	// press drops the construct rather than merging upward. Live mode only, since at raw 0 in
	// source mode the key does nothing.
	test('Backspace at the start of a painted `# ` drops the construct in one press', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '# ');
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceNotContains('#');

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('paragraph');
		expect(await ep.bridge.getBlockCount()).toBe(2);

		await ep.undo();
		await ep.bridge.waitForSourceContains('# ');
	});
});

test.describe('loaded openers — the paint half needs no typing', () => {
	// A content-empty opener is silent until the caret arrives: an unfocused bare `#` or empty
	// fence shows nothing. Focusing the heading paints its marker; focusing the empty fence
	// completes it with a body line and offers the language picker instead of painting.
	test('live paints a bare heading and an empty fence once the caret arrives', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		const fenceLines = ep.getBlock(1).locator('.md-fence-line');
		await expect(fenceLines).toHaveCount(2);
		await expect(fenceLines.first()).toHaveCSS('display', 'none');

		await ep.clickBlock(OPENER);
		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');

		// The empty fence stands first in its own document, where its collapsed box is what the
		// pointer reaches: the side gutter mounts on hover, and the click completes the fence.
		const fence = await enterPresentationMode(page, 'live', EMPTY_FENCE_FIRST);
		await fence.getBlock(0).hover();
		await fence.clickBlock(0);
		await fence.bridge.waitForSourceContains('```\n\n```');
		await expect(page.locator('.code-lang-picker input')).toBeVisible();
	});

	test('preview-inline paints the same chrome on the focused block only', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'preview-inline', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		await ep.clickBlock(OPENER);
		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');

		const fence = await enterPresentationMode(page, 'preview-inline', EMPTY_FENCE_FIRST);
		await fence.getBlock(0).hover();
		await fence.clickBlock(0);
		await fence.bridge.waitForSourceContains('```\n\n```');
		await expect(page.locator('.code-lang-picker input')).toBeVisible();
	});

	// Reading takes no keystrokes, so it keeps the rendered document's silence.
	test('reading mode paints neither', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'reading', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		await expect(ep.getBlock(1).locator('.md-fence-line').first()).toHaveCSS('display', 'none');
	});
});

// The two modes run the same three gestures: where every byte is on screen, live has to match
// source, and the assertion is the whole source rather than a substring, since `[](u` sits
// inside `[](u)` and only equality tells one byte gone from none.
for (const mode of ['live', 'source'] as const) {
	test.describe(`painted inline chrome — ${mode} takes what the reader aimed at`, () => {
		let ep: EditorPage;

		test.beforeEach(async ({ page }) => {
			ep = await enterPresentationMode(page, mode, EMPTY_LINK);
			await clickBlockSettled(ep, OPENER);
		});

		test('Backspace at the end takes one byte', async ({ page }) => {
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Backspace');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u\n');
		});

		test('Delete at the start takes one byte', async ({ page }) => {
			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Delete');
			await expect.poll(() => ep.bridge.getSource()).toBe('](u)\n');
		});

		test('a letter typed at the end appends', async ({ page }) => {
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.type('a');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u)a\n');
		});

		test('a letter typed inside the chrome lands where the caret is', async ({ page }) => {
			await landAt(ep, page, MID_CHROME);

			await page.keyboard.type('a');
			await expect.poll(() => ep.bridge.getSource()).toBe('[]a(u)\n');
		});
	});
}

// The other four live rewrites reach the same block. Each is correct only because the answer it
// computes cancels against its own check, so these pin the outcomes rather than the reasoning:
// a rewrite that starts reading painted bytes as unseen moves one of them.
const CARD = '[data-link-card]';

test.describe('painted inline chrome — the live rewrites leave what the reader sees alone', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', PAINTED_LINK_DOC);
		await clickBlockSettled(ep, OPENER);
		await landAt(ep, page, MID_CHROME);
	});

	test('Enter inside the chrome cuts the bytes literally', async ({ page }) => {
		await page.keyboard.press('Enter');
		await ep.bridge.waitForBlockCount(3);

		expect(await ep.bridge.getSource()).toBe('[]\n\n(u)\n\npara\n');
	});

	test('a pending bold mark writes no delimiter into the chrome', async ({ page }) => {
		await page.keyboard.press('ControlOrMeta+b');
		await ep.waitForRenderFlush();

		await page.keyboard.type('x');
		await expect.poll(() => ep.bridge.getSource()).toBe('[]x(u)\n\npara\n');
	});

	test('the card still rewrites the destination the chrome is showing', async ({ page }) => {
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(`${CARD} input`)).toBeFocused();

		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('v');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('[](v)');
	});
});

// A construct wrapping empty markers paints its own delimiters too, so the two paths that
// rewrite across a cut meet a painted pair where they usually meet a hidden one.
test.describe('painted chrome inside a construct the cut seams open', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', WRAPPED_DOC);
		await clickBlockSettled(ep, OPENER);
		await landAt(ep, page, INSIDE_PAIR);
	});

	test('a range delete into the block below leaves the painted pair standing', async ({ page }) => {
		await extendTo(ep, page, 'ArrowRight', [1], 0);

		await page.keyboard.press('Delete');
		await ep.bridge.waitForBlockCount(1);

		expect(await ep.bridge.getSource()).toBe('**para\n');
	});

	test('Enter cuts the bytes literally instead of carrying the opener across', async ({ page }) => {
		await page.keyboard.press('Enter');
		await ep.bridge.waitForBlockCount(3);

		expect(await ep.bridge.getSource()).toBe('**\n\n[](u)**\n\npara\n');
	});
});

test('Backspace below painted chrome concatenates the two blocks literally', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', PAINTED_LINK_DOC);
	await clickBlockSettled(ep, 1);
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();

	await page.keyboard.press('Backspace');
	await ep.bridge.waitForBlockCount(1);

	expect(await ep.bridge.getSource()).toBe('[](u)para\n');
});

import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, extendTo, landAt, nextRow } from './helpers';

// A block whose only bytes are its own markers has no content to stand behind them, so they paint:
// a caret can land on them and a typed byte goes after them. A destructive key at the block's own
// structure follows the mode; one at an inline construct follows what is painted. Each test walks
// its rows as steps, every step on a fresh copy of its document.
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

/** A fresh empty paragraph below an existing one, made by the gesture that makes it in real use. */
async function emptyBlockBelow(ep: EditorPage, page: Page): Promise<void> {
	await nextRow(ep, 'lorem\n');
	await clickBlockSettled(ep, OPENER);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Enter');
	await ep.bridge.waitForBlockCount(2);
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

test.describe('live mode: a typed block opener paints until it has content', () => {
	test('a typed `#`', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '\n');

		await test.step('typing `#` paints the marker the keystroke just created', async () => {
			await emptyBlockBelow(ep, page);

			await typeSettled(ep, page, '#');

			expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
			await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
			// The h1 type waits for the space, since `#` also starts `#tag`, and a line jumping to h1
			// size for one keystroke reads as the editor fighting the tag.
			await expect(ep.getBlock(TYPED)).toHaveClass(/paragraph-block/);
		});

		await test.step('the next letter lands after the painted marker, not in front of it', async () => {
			await emptyBlockBelow(ep, page);
			await typeSettled(ep, page, '#');

			await typeSettled(ep, page, 'a');

			await expect.poll(() => ep.bridge.getBlockKind(TYPED)).toBe('paragraph');
			expect(await ep.bridge.getSource()).toContain('#a');
		});

		await test.step('a space keeps the heading painted; the first content character folds it', async () => {
			await emptyBlockBelow(ep, page);
			await typeSettled(ep, page, '#');

			await typeSettled(ep, page, ' ');
			expect(await ep.bridge.getSource()).toContain('# ');
			expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
			await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
			await expect(ep.getBlock(TYPED)).toHaveClass(/heading-1/);

			await typeSettled(ep, page, 'a');
			expect(await ep.bridge.getSource()).toContain('# a');
			expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
			await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'none');
		});
	});

	test('three backticks paint their fence line, and the info string appends after it', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', '\n');
		await emptyBlockBelow(ep, page);

		// Not `typeSettled`: the second backtick steps over the one auto-pairing added after the
		// first, so that keystroke changes no byte to wait on.
		await page.keyboard.type('```');
		await ep.bridge.waitForSourceContains('```');
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('fencedCode');

		// The completed fence offers its language picker; Enter writes the info string and returns the
		// caret to the body, whose hidden backticks leave the typed byte as the proof.
		const picker = page.locator('.code-lang-picker input');
		await expect(picker).toBeVisible();
		await page.keyboard.type('js');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('```js');
		await expect(ep.getBlock(TYPED).locator('.md-fence-line').first()).toHaveCSS('display', 'none');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('```js\nX');
	});

	test('Backspace in a painted `# `', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '\n');

		// The demote reads the first offset the caret can reach, so painting the markers turns this
		// key into the marker-byte delete that source mode performs.
		await test.step('inside it, Backspace takes the marker byte and does not demote', async () => {
			await emptyBlockBelow(ep, page);
			await typeSettled(ep, page, '# ');

			const before = await ep.bridge.getSource();
			await page.keyboard.press('Backspace');
			await ep.bridge.waitForSourceWith((source, previous) => source !== previous, before);

			expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
			await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
		});

		// Raw 0 is reachable once the markers paint, and one Backspace there drops the construct
		// rather than merging upward; live only, since source mode does nothing at raw 0.
		await test.step('at its start, Backspace drops the construct in one press', async () => {
			await emptyBlockBelow(ep, page);
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
});

// A focused empty heading paints its markers, so a key typed on them lands where the caret is,
// the way source mode writes it.
test('live mode: a key typed on a painted empty heading lands at the caret', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', '\n');

	for (const [source, path, pressed, key, written] of [
		['# \n\nnext\n', [0], ['Home'], '#', '## \n\nnext\n'],
		['> ## \n\nnext\n', [0, 0], ['Home'], '#', '> ### \n\nnext\n'],
		['#  #\n\nnext\n', [0], ['Home'], '#', '##  #\n\nnext\n'],
		['#\n\nnext\n', [0], ['Home'], 'a', 'a#\n\nnext\n'],
		['# \n\nnext\n', [0], ['End', 'ArrowLeft'], 'x', '#x \n\nnext\n']
	] as const) {
		await test.step(`${JSON.stringify(source)}, ${pressed.join(' ')}, then ${JSON.stringify(key)}`, async () => {
			await nextRow(ep, source);
			await ep.focusBlockAtPath([...path], 0);
			for (const k of pressed) await page.keyboard.press(k);
			await ep.waitForRenderFlush();
			await page.keyboard.type(key);
			await ep.bridge.waitForSourceEquals(written);
		});
	}
});

test.describe('loaded openers: the paint half needs no typing', () => {
	// An unfocused bare `#` or empty fence shows nothing. Focusing the heading paints its marker;
	// focusing the empty fence completes it with a body line and offers the language picker.
	test('live paints a bare heading and an empty fence once the caret arrives', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		const fenceLines = ep.getBlock(1).locator('.md-fence-line');
		await expect(fenceLines).toHaveCount(2);
		await expect(fenceLines.first()).toHaveCSS('display', 'none');

		await ep.clickBlock(OPENER);
		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');

		await completeEmptyFence(ep, page);
	});

	test('preview-inline paints the same chrome on the focused block only', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'preview-inline', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		await ep.clickBlock(OPENER);
		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');

		await completeEmptyFence(ep, page);
	});

	// The empty fence stands first in its own document, where its collapsed box is what the pointer
	// reaches: the side gutter mounts on hover, and the click completes the fence.
	async function completeEmptyFence(ep: EditorPage, page: Page): Promise<void> {
		await nextRow(ep, EMPTY_FENCE_FIRST);
		await ep.getBlock(0).hover();
		await ep.clickBlock(0);
		await ep.bridge.waitForSourceContains('```\n\n```');
		await expect(page.locator('.code-lang-picker input')).toBeVisible();
	}

	// Reading takes no keystrokes, so it keeps the rendered document's silence.
	test('reading mode paints neither', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'reading', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		await expect(ep.getBlock(1).locator('.md-fence-line').first()).toHaveCSS('display', 'none');
	});
});

// Where every byte is on screen live must match source, compared on the whole source: `[](u`
// sits inside `[](u)`, and only equality tells one byte gone from none.
for (const mode of ['live', 'source'] as const) {
	test(`painted inline chrome: ${mode} takes what the reader aimed at`, async ({ page }) => {
		const ep = await enterPresentationMode(page, mode, EMPTY_LINK);
		const row = async () => {
			await nextRow(ep, EMPTY_LINK);
			await clickBlockSettled(ep, OPENER);
		};

		await test.step('Backspace at the end takes one byte', async () => {
			await row();
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Backspace');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u\n');
		});

		await test.step('Delete at the start takes one byte', async () => {
			await row();
			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Delete');
			await expect.poll(() => ep.bridge.getSource()).toBe('](u)\n');
		});

		await test.step('a letter typed at the end appends', async () => {
			await row();
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.type('a');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u)a\n');
		});

		await test.step('a letter typed inside the chrome lands where the caret is', async () => {
			await row();
			await landAt(ep, page, MID_CHROME);

			await page.keyboard.type('a');
			await expect.poll(() => ep.bridge.getSource()).toBe('[]a(u)\n');
		});
	});
}

// The other four live rewrites reach the same block, each correct only because its answer cancels
// its own check, so these check the outcomes: reading painted bytes as unseen moves one.
const CARD = '[data-link-card]';

test('painted inline chrome: the live rewrites leave what the reader sees alone', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', PAINTED_LINK_DOC);
	const row = async () => {
		await nextRow(ep, PAINTED_LINK_DOC);
		await clickBlockSettled(ep, OPENER);
		await landAt(ep, page, MID_CHROME);
	};

	await test.step('Enter inside the chrome cuts the bytes literally', async () => {
		await row();
		await page.keyboard.press('Enter');
		await ep.bridge.waitForBlockCount(3);

		expect(await ep.bridge.getSource()).toBe('[]\n\n(u)\n\npara\n');
	});

	await test.step('a pending bold mark writes no delimiter into the chrome', async () => {
		await row();
		await page.keyboard.press('ControlOrMeta+b');
		await ep.waitForRenderFlush();

		await page.keyboard.type('x');
		await expect.poll(() => ep.bridge.getSource()).toBe('[]x(u)\n\npara\n');
	});

	await test.step('the card still rewrites the destination the chrome is showing', async () => {
		await row();
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
test('painted chrome inside a construct the cut leaves open', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', WRAPPED_DOC);
	const row = async () => {
		await nextRow(ep, WRAPPED_DOC);
		await clickBlockSettled(ep, OPENER);
		await landAt(ep, page, INSIDE_PAIR);
	};

	await test.step('a range delete into the block below leaves the painted pair standing', async () => {
		await row();
		await extendTo(ep, page, 'ArrowRight', [1], 0);

		await page.keyboard.press('Delete');
		await ep.bridge.waitForBlockCount(1);

		expect(await ep.bridge.getSource()).toBe('**para\n');
	});

	await test.step('Enter cuts the bytes literally instead of carrying the opener across', async () => {
		await row();
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

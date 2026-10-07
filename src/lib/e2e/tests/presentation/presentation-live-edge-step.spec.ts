import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickEnd, enterPresentationMode, focusPath, held, keys, nextRow } from './helpers';

// An arrow press at a hidden construct edge moves the typing offset, not the caret. The pixel
// never moves, so the source and the ring are what tell the two offsets apart. Each test walks
// its rows as steps, every step on a fresh copy of the document.
// Requirements: e2e/requirements/presentation/presentation-live-edge-step.md.

test('live mode: a code span that ends its line', async ({ page }) => {
	const DOC = '- [ ] possibly via `scheduled`\n\nplain';
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'scheduled');
	};

	await test.step('a click at its end types inside', async () => {
		await atEnd();
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});

	await test.step('one ArrowRight types past the backtick, in the same block', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('- [ ] possibly via `scheduled`)\n');
	});

	await test.step('a second ArrowRight leaves the block', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight', 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains(')plain');
	});

	await test.step('ArrowLeft steps back inside', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight', 'ArrowLeft');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});
});

// The same line-ending edge on a construct whose ring the second step checks.
test('live mode: a hidden-marker construct that ends its line', async ({ page }) => {
	const DOC = '- [ ] possibly via **scheduled**\n\nplain';
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'scheduled');
	};

	await test.step('Shift+ArrowRight never stops at a hidden edge', async () => {
		await atEnd();
		const start = await focusPath(ep);
		await keys(ep, page, 'Shift+ArrowRight');
		const sel = await ep.bridge.getSelectionPaths();
		expect(sel?.focus.path.join()).not.toBe(start.join());
	});

	await test.step('the ring shows inside, and goes with the step out', async () => {
		await atEnd();
		await expect.poll(() => held(page)).toEqual(['strong']);
		await keys(ep, page, 'ArrowRight');
		await expect.poll(() => held(page)).toEqual([]);
		await keys(ep, page, 'ArrowLeft');
		await expect.poll(() => held(page)).toEqual(['strong']);
	});
});

test('live mode: every symmetric pair, mid-line', async ({ page }) => {
	const DOC = [
		'a `code` b',
		'',
		'a **bold** b',
		'',
		'a *em* b',
		'',
		'a ~~gone~~ b',
		'',
		'a [link](https://x.example)',
		'',
		'tail'
	].join('\n');
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async (word: string) => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, word);
	};

	for (const [word, after, beyond] of [
		['code', 'a `code`X b', 'a `code` Xb'],
		['bold', 'a **bold**X b', 'a **bold** Xb'],
		['em', 'a *em*X b', 'a *em* Xb'],
		['gone', 'a ~~gone~~X b', 'a ~~gone~~ Xb']
	] as const) {
		await test.step(`${word}: one press types past the closer, the second moves the caret`, async () => {
			await atEnd(word);
			await keys(ep, page, 'ArrowRight');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(after);
		});

		await test.step(`${word}: two presses move the caret past the space`, async () => {
			await atEnd(word);
			await keys(ep, page, 'ArrowRight', 'ArrowRight');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(beyond);
		});
	}

	await test.step('a link offers only its outside: ArrowRight at its end leaves the block', async () => {
		await atEnd('link');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});

	await test.step('a leading edge: ArrowLeft from the first content byte steps outside the opener first', async () => {
		await atEnd('bold');
		// Walk left to the first content byte: each press moves the caret until the opener.
		await keys(ep, page, ...Array<string>(4).fill('ArrowLeft'));
		await keys(ep, page, 'ArrowLeft');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a X**bold** b');
	});
});

test('live mode: abutting closers take one press per run', async ({ page }) => {
	const DOC = 'a ***both***\n\ntail';
	const ep = await enterPresentationMode(page, 'live', DOC);

	for (const [presses, source, rings] of [
		[0, 'a ***bothX***', ['em', 'strong']],
		[1, 'a ***both**X*', ['em']],
		[2, 'a ***both***X', []]
	] as const) {
		await test.step(`${presses} press(es) at the end`, async () => {
			await nextRow(ep, DOC);
			await clickEnd(ep, page, 'both');
			await keys(ep, page, ...Array<string>(presses).fill('ArrowRight'));
			await expect.poll(async () => (await held(page)).sort()).toEqual([...rings].sort());
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(source);
		});
	}

	await test.step('a third press leaves the block', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'both');
		await keys(ep, page, 'ArrowRight', 'ArrowRight', 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});
});

test('live mode: in a table cell, one ArrowRight types past the backtick inside the cell', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', '| h | h2 |\n| - | - |\n| a `cee` | z |');
	await clickEnd(ep, page, 'cee');
	await keys(ep, page, 'ArrowRight');
	await page.keyboard.type('X');
	await ep.bridge.waitForSourceContains('| a `cee`X | z |');
});

// Live keeps a code span's backticks hidden like every other marker: the edge step and the ring
// are the cue at its edge, in prose and in a cell alike.
test("live mode: a code span's backticks stay hidden, and the ring marks it instead", async ({
	page
}) => {
	/** The computed display of the spans either side of each code element. */
	const backticks = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('code.inline-code-content')].flatMap((code) =>
				[code.previousElementSibling, code.nextElementSibling].map((el) =>
					el ? getComputedStyle(el).display : 'missing'
				)
			)
		);
	const ep = await enterPresentationMode(page, 'live', '\n');

	for (const [place, doc, word] of [
		['prose', 'a `code` b\n\ntail', 'code'],
		['a table cell', '| h | h2 |\n| - | - |\n| a `cee` | z |', 'cee']
	] as const) {
		await test.step(`${place}: with the caret at the span's end`, async () => {
			await nextRow(ep, doc);
			await clickEnd(ep, page, word);
			await expect.poll(backticks).toEqual(['none', 'none']);
			await expect.poll(() => held(page)).toEqual(['code']);
		});
	}
});

/** Whether the ringed construct draws the ring's colour around itself, read off its computed style,
 *  with the ring and the code chip's border colours from the editor's own theme. */
async function ringPaint(page: Page): Promise<{ shown: boolean; ring: string; border: string }> {
	return page.evaluate(() => {
		const theme = document.querySelector('.aragonite-editor-theme');
		if (!theme) throw new Error('no themed wrapper');
		const probe = document.createElement('span');
		theme.appendChild(probe);
		probe.style.color = 'var(--md-edge-held-ring)';
		const ring = getComputedStyle(probe).color;
		probe.style.color = 'var(--md-inline-code-border)';
		const border = getComputedStyle(probe).color;
		probe.remove();
		const held = document.querySelector('.md-edge-held');
		if (!held) return { shown: false, ring, border };
		const style = getComputedStyle(held);
		const outlined =
			style.outlineStyle !== 'none' &&
			parseFloat(style.outlineWidth) > 0 &&
			style.outlineColor === ring;
		const shadowed = style.boxShadow
			.split(/,(?![^(]*\))/)
			.some((shadow) => shadow.includes(ring) && !shadow.includes('inset'));
		return { shown: outlined || shadowed, ring, border };
	});
}

test.describe('live mode: the ring paints on every symmetric pair, in both themes', () => {
	const DOC = [
		'`alone`',
		'',
		'a `code` b',
		'',
		'a **bold** b',
		'',
		'a *em* b',
		'',
		'a ~~gone~~ b'
	].join('\n');

	for (const theme of ['light', 'dark']) {
		test(theme, async ({ page }) => {
			const ep = new EditorPage(page);
			await ep.goto(`?presentationMode=live&theme=${theme}`);

			for (const word of ['alone', 'code', 'bold', 'em', 'gone']) {
				await test.step(`at the end of ${word}`, async () => {
					await nextRow(ep, DOC);
					await clickEnd(ep, page, word);
					await expect.poll(async () => (await held(page)).length).toBe(1);

					const paint = await ringPaint(page);
					expect(paint.shown).toBe(true);
					expect(paint.ring).not.toBe(paint.border);
				});
			}
		});
	}
});

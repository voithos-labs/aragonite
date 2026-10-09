import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { drawnCaretBox, drawnCaretMarks, nativeCaretBox } from '../../carets-showing';
import {
	clickEnd,
	clickWordSettled,
	enterPresentationMode,
	keys,
	nextRow
} from '../presentation/helpers';

// The drawn caret shows what the next typed letter will be (requirements/caret/drawn-caret-look.md).
// Every step reads the look, then types and reads the bytes, so the look is checked against what the
// letter became. Each test walks its rows as steps, every step on a fresh copy of the document.

const CONSTRUCTS = [
	{ name: 'bold', word: 'bold', delimiter: '**', marks: ['strong'], chord: 'ControlOrMeta+b' },
	{ name: 'italic', word: 'slant', delimiter: '*', marks: ['emphasis'], chord: 'ControlOrMeta+i' },
	{
		name: 'strikethrough',
		word: 'gone',
		delimiter: '~~',
		marks: ['strikethrough'],
		chord: 'ControlOrMeta+Shift+X'
	}
] as const;

const HOSTS = [
	{ name: 'a paragraph', doc: (line: string) => line },
	{ name: 'a table cell', doc: (line: string) => `| h |\n| - |\n| ${line} |` }
];

/** The look read once, right after a press has rendered, with no polling for a later one. */
async function expectLookNow(page: Page, marks: readonly string[], when: string): Promise<void> {
	expect(await drawnCaretMarks(page), when).toEqual(marks);
}

/** The bar's x within half a pixel of `x`. */
async function expectBarAt(page: Page, x: number): Promise<void> {
	const box = await drawnCaretBox(page);
	expect(box, 'the drawn caret draws').not.toBeNull();
	expect(Math.abs(box!.left - x), `x ${box!.left} vs ${x}`).toBeLessThanOrEqual(0.5);
}

async function barX(page: Page): Promise<number> {
	await expect.poll(() => drawnCaretBox(page)).not.toBeNull();
	return (await drawnCaretBox(page))!.left;
}

for (const c of CONSTRUCTS) {
	for (const host of HOSTS) {
		test(`live mode: ${c.name} in ${host.name}, inside and out`, async ({ page }) => {
			const d = c.delimiter;
			const construct = `${d}${c.word}${d}`;
			const ep = await enterPresentationMode(page, 'live', host.doc(`a ${construct} b`));

			for (const [place, tail] of [
				['mid-line', ' b'],
				['at the line’s end', '']
			] as const) {
				const doc = host.doc(`a ${construct}${tail}`);
				const fresh = async (held: boolean) => {
					await nextRow(ep, doc);
					await clickEnd(ep, page, c.word);
					await expect.poll(() => drawnCaretMarks(page), 'inside').toEqual(c.marks);
					if (!held) return;
					await page.keyboard.type(' ');
					await ep.waitForRenderFlush();
					await expectLookNow(page, c.marks, 'a held space');
				};
				const typed = async (want: string) => {
					await page.keyboard.type('X');
					await ep.bridge.waitForSourceContains(want);
				};

				await test.step(`${place}: the inside end types inside`, async () => {
					await fresh(false);
					await typed(`a ${d}${c.word}X${d}${tail}`);
				});

				await test.step(`${place}: a held space types inside`, async () => {
					await fresh(true);
					await typed(`a ${d}${c.word} X${d}${tail}`);
				});

				for (const held of [false, true]) {
					const space = held ? ' ' : '';
					const label = `${place}${held ? ', after a held space' : ''}`;

					await test.step(`${label}: one ArrowRight keeps the x and the look turns plain`, async () => {
						await fresh(held);
						const x = await barX(page);
						await keys(ep, page, 'ArrowRight');
						await expectLookNow(page, [], 'after one ArrowRight');
						await expectBarAt(page, x);
						await typed(`a ${construct}${space}X${tail}`);
					});

					await test.step(`${label}: the typed closer turns the look plain`, async () => {
						await fresh(held);
						// A held space already sits past the closer, so one of its bytes steps out.
						await page.keyboard.type(held ? d[0] : d);
						await ep.waitForRenderFlush();
						await expectLookNow(page, [], 'after the closer');
						await typed(`a ${construct}${space}X${tail}`);
						expect(await ep.bridge.getSource()).not.toContain(d + d);
					});

					await test.step(`${label}: the chord turns the look plain before any letter`, async () => {
						await fresh(held);
						await keys(ep, page, c.chord);
						await expectLookNow(page, [], 'after the chord');
						await typed(`a ${construct}${space}X${tail}`);
					});

					if (tail !== '') continue;
					await test.step(`${label}: End turns the look plain`, async () => {
						if (held) await fresh(true);
						else {
							await nextRow(ep, doc);
							await clickWordSettled(ep, page, c.word);
						}
						await keys(ep, page, 'End');
						await expectLookNow(page, [], 'after End');
						await typed(`a ${construct}${space}X`);
					});
				}
			}
		});
	}
}

test('live mode: the bold chord at a plain caret shows bold before any letter', async ({
	page
}) => {
	const DOC = 'plain words here';
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('once: bold, and the letter types bold', async () => {
		await clickWordSettled(ep, page, 'words');
		await keys(ep, page, 'ControlOrMeta+b');
		await expectLookNow(page, ['strong'], 'after the chord');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('**X**');
	});

	await test.step('twice: plain, and the letter types plain', async () => {
		await nextRow(ep, DOC);
		await clickWordSettled(ep, page, 'words');
		await keys(ep, page, 'ControlOrMeta+b', 'ControlOrMeta+b');
		await expectLookNow(page, [], 'after the second chord');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('X');
		expect(await ep.bridge.getSource()).not.toContain('*');
	});
});

interface Shape {
	width: number;
	/** The x-skew factor of the bar's transform, 0 for none. */
	skew: number;
	tick: { width: number; height: number; top: number } | null;
	barHeight: number;
	color: string;
}

/** What the drawn bar draws, read from the computed style, its `::after` tick included. */
function drawnShape(page: Page): Promise<Shape> {
	return page.evaluate(() => {
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret[data-caret-state="text"]')!;
		const style = getComputedStyle(bar);
		const after = getComputedStyle(bar, '::after');
		const matrix = /^matrix\(([^)]+)\)$/.exec(style.transform);
		const drawsTick = after.content !== 'none' && after.content !== 'normal';
		return {
			width: parseFloat(style.width),
			skew: matrix ? Number(matrix[1].split(',')[2]) : 0,
			tick: drawsTick
				? {
						width: parseFloat(after.width),
						height: parseFloat(after.height),
						top: parseFloat(after.top)
					}
				: null,
			barHeight: parseFloat(style.height),
			color: style.backgroundColor
		};
	});
}

const SHAPES: [word: string, marks: string[], expectShape: (shape: Shape) => void][] = [
	[
		'plain',
		[],
		(s) =>
			expect({ width: s.width, skew: s.skew, tick: s.tick }).toEqual({
				width: 1,
				skew: 0,
				tick: null
			})
	],
	[
		'bold',
		['strong'],
		(s) =>
			expect({ width: s.width, skew: s.skew, tick: s.tick }).toEqual({
				width: 3,
				skew: 0,
				tick: null
			})
	],
	[
		'slant',
		['emphasis'],
		(s) => {
			expect(s.width).toBe(1);
			expect(Math.abs(s.skew), 'the bar slants').toBeGreaterThan(0.1);
		}
	],
	[
		'gone',
		['strikethrough'],
		(s) => {
			expect(s.tick, 'a tick crosses the bar').not.toBeNull();
			expect({ width: s.tick!.width, height: s.tick!.height }).toEqual({ width: 7, height: 1 });
			expect(Math.abs(s.tick!.top - s.barHeight * 0.55)).toBeLessThanOrEqual(1);
		}
	],
	[
		'both',
		['strong', 'emphasis'],
		(s) => {
			expect(s.width).toBe(3);
			expect(Math.abs(s.skew), 'the heavy bar slants').toBeGreaterThan(0.1);
		}
	],
	[
		'code',
		['inlineCode'],
		(s) =>
			expect({ width: s.width, skew: s.skew, tick: s.tick }).toEqual({
				width: 1,
				skew: 0,
				tick: null
			})
	]
];

for (const theme of ['light', 'dark'] as const) {
	test(`live mode: each look draws its shape in the ${theme} theme`, async ({ page }) => {
		const DOC = 'plain **bold** *slant* ~~gone~~ ***both*** `code` end';
		const ep = new EditorPage(page);
		await ep.goto(
			theme === 'light' ? '?presentationMode=live&theme=light' : '?presentationMode=live'
		);
		await ep.loadContent(DOC);

		for (const [word, marks, expectShape] of SHAPES) {
			await test.step(word, async () => {
				await clickWordSettled(ep, page, word);
				await expect.poll(() => drawnCaretMarks(page)).toEqual(marks);
				const shape = await drawnShape(page);
				expectShape(shape);
				expect(shape.color, 'the bar has a color').not.toBe('rgba(0, 0, 0, 0)');
				// The shape keeps the bar's foot where the browser's caret stands.
				const drawn = (await drawnCaretBox(page))!;
				const native = (await nativeCaretBox(page))!;
				expect(
					Math.abs(drawn.left - native.left),
					`x ${drawn.left} vs ${native.left}`
				).toBeLessThanOrEqual(1);
				expect(Math.abs(drawn.top - native.top)).toBeLessThanOrEqual(1);
				expect(Math.abs(drawn.height - native.height)).toBeLessThanOrEqual(1);
			});
		}
	});
}

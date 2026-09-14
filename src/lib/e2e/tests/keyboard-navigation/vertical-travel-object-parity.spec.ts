import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage, activeBlockPath } from '../plugins/helpers';

// An image-only paragraph carries no text column but is enterable as an object, so vertical travel
// STOPS on it — one press each way (requirements/keyboard-navigation/vertical-travel-object-parity.md).
// The image sits in a details body, the shape that puts a gap caret between it and the blocks
// outside, so the walk crosses both vertical doors: the per-block landing and the container entry.

const DOC = [
	'top paragraph.',
	'',
	'---',
	'',
	'<details open>',
	'<summary>Bring her back.</summary>',
	'',
	'![pic|120x120](/test-fixtures/sample.png)',
	'',
	'</details>',
	'',
	'---',
	'',
	'start here.',
	'',
	'tail paragraph.',
	''
].join('\n');

const TOP = JSON.stringify([0]);

/** Walk one direction to the top paragraph, reporting the presses it took and how many of them
 *  landed on the image. Bounded: a walk that never arrives fails on the count, not by hanging. */
async function walkUpToTop(editor: PluginsPage): Promise<{ presses: number; imageStops: number }> {
	let imageStops = 0;
	for (let presses = 1; presses <= 10; presses++) {
		await editor.page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();
		if ((await editor.page.locator('[data-image-overlay]').count()) > 0) imageStops++;
		if (JSON.stringify(await activeBlockPath(editor.page)) === TOP) return { presses, imageStops };
	}
	throw new Error('ArrowUp never reached the top paragraph');
}

test.describe('vertical travel past an image-only paragraph', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(DOC);
		await editor.setPresentationMode('live');
		await expect(page.locator('[data-image-widget]')).toHaveCount(1);
		await editor.focusBlockStart(4);
	});

	test('the same number of ArrowDowns returns the caret to the block the ArrowUps left', async () => {
		const { presses } = await walkUpToTop(editor);

		for (let i = 0; i < presses; i++) {
			await editor.page.keyboard.press('ArrowDown');
			await editor.waitForRenderFlush();
		}
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const src = await editor.bridge.getSource();
		expect(src).toContain('Xstart here.');
		expect(src).not.toMatch(/!\[pic[^\n]*X|X[^\n]*\/test-fixtures/);
	});

	test('the image is one stop on the way up and one on the way down', async () => {
		const up = await walkUpToTop(editor);
		expect(up.imageStops).toBe(1);

		let downStops = 0;
		for (let i = 0; i < up.presses; i++) {
			await editor.page.keyboard.press('ArrowDown');
			await editor.waitForRenderFlush();
			if ((await editor.page.locator('[data-image-overlay]').count()) > 0) downStops++;
		}
		expect(downStops).toBe(1);
	});
});

// A step-over widget carries a column, so a paragraph holding only one is NOT an object stop: it
// is a caret stop, seated beside the glyph, and still one press in and one press out each way.

const surrounded = (middle: string) =>
	['top paragraph.', '', middle, '', 'start here.', ''].join('\n');

const MIDDLE = 1;

/** Walk one direction until the caret reaches `destination`, reporting the presses it took and how
 *  many landed in the middle block. Bounded: a walk that never arrives fails on the count. */
async function walkAcross(
	editor: EditorPage,
	key: 'ArrowUp' | 'ArrowDown',
	destination: number
): Promise<{ presses: number; stops: number }> {
	let stops = 0;
	for (let presses = 1; presses <= 6; presses++) {
		await editor.page.keyboard.press(key);
		await editor.waitForRenderFlush();
		const head = (await activeBlockPath(editor.page))?.[0];
		if (head === MIDDLE) stops++;
		if (head === destination) return { presses, stops };
	}
	throw new Error(`${key} never reached block ${destination}`);
}

const ENTITY_SHAPES = [
	{ label: 'a lone entity', middle: '&copy;', glyphs: 1 },
	{ label: 'two adjacent entities', middle: '&copy;&reg;', glyphs: 2 },
	{ label: 'a list item holding one', middle: '- &copy;', glyphs: 1 },
	{ label: 'an entity followed by prose', middle: '&copy; reserved', glyphs: 1 }
];

test.describe('vertical travel past an entity-only paragraph', () => {
	for (const { label, middle, glyphs } of ENTITY_SHAPES) {
		test(`${label}: one press in and one out, both directions`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(surrounded(middle));
			await expect(page.locator('[data-inline-widget]')).toHaveCount(glyphs);
			await editor.focusBlockAtPath([2], 3);

			expect(await walkAcross(editor, 'ArrowUp', 0)).toEqual({ presses: 2, stops: 1 });
			expect(await walkAcross(editor, 'ArrowDown', 2)).toEqual({ presses: 2, stops: 1 });
		});
	}

	const STEPPED_SEATS = [
		{ label: 'past the only glyph', middle: '&copy;' },
		{ label: 'between two adjacent glyphs', middle: '&copy;&reg;' }
	];

	for (const { label, middle } of STEPPED_SEATS) {
		test(`a caret stepped ${label} leaves on one press, either direction`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(surrounded(middle));
			// One press crosses a whole glyph, so this seat touches no text node on either side.
			await editor.focusBlockAtPath([MIDDLE], 0);
			await page.keyboard.press('ArrowRight');

			expect(await walkAcross(editor, 'ArrowUp', 0)).toEqual({ presses: 1, stops: 0 });
			await editor.focusBlockAtPath([MIDDLE], 0);
			await page.keyboard.press('ArrowRight');
			expect(await walkAcross(editor, 'ArrowDown', 2)).toEqual({ presses: 1, stops: 0 });
		});
	}
});

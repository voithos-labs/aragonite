import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

// The crop is limestone's cover crop on an inline image: the toolbar's crop button turns the
// image into a pan surface (drag pans, the wheel zooms) and the tick writes `|WxH@X,Y[,Z]`.
test.describe('image crop', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectAndStartCrop(page: import('@playwright/test').Page) {
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.locator('.md-image-properties').getByRole('button', { name: 'Crop image' }).click();
		await expect(page.locator('.md-image-crop-surface')).toBeVisible();
		return widget;
	}

	test('a double click on the picture starts the crop', async ({ page }) => {
		await editor.loadContent('![cat|200x200](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();

		// A single click only selects it: the toolbar appears, the pan surface does not.
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await expect(page.locator('.md-image-crop-surface')).toHaveCount(0);

		await widget.dblclick();
		await expect(page.locator('.md-image-crop-surface')).toBeVisible();
		// A crop is not a text gesture: the double click leaves no range behind.
		expect(await page.evaluate(() => String(document.getSelection()))).toBe('');

		await page.keyboard.press('Escape');
		await expect(page.locator('.md-image-crop-surface')).toHaveCount(0);
	});

	test('a drag pans the window and the tick writes the crop into the hint', async ({ page }) => {
		// A square frame on a landscape fixture: the cover fit overflows sideways, so a drag pans x.
		await editor.loadContent('![cat|200x200](/test-fixtures/sample.png)\n');
		const widget = await selectAndStartCrop(page);
		// The resize grip steps aside while the pan surface owns the pointer.
		await expect(page.locator('.md-resize-handle')).toHaveCount(0);

		const box = (await widget.boundingBox())!;
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		await page.mouse.move(cx - 40, cy, { steps: 6 });
		await page.mouse.up();

		await page.locator('.md-image-properties').getByRole('button', { name: 'Apply crop' }).click();
		await editor.bridge.waitForSourceMatches(
			/!\[cat\|200x200@\d+,50\]\(\/test-fixtures\/sample\.png\)/
		);
		const src = await editor.bridge.getSource();
		const x = Number(/@(\d+),50/.exec(src)![1]);
		expect(x, 'dragging left shows more of the right side').toBeGreaterThan(50);

		// The committed crop renders as a fixed frame the image pans inside.
		const cropped = page.locator('[data-image-widget].md-image-cropped').first();
		await expect(cropped).toHaveCount(1);
		const img = cropped.locator('img');
		await expect(img).toHaveCSS('object-fit', 'cover');
		const frame = (await cropped.boundingBox())!;
		expect(Math.round(frame.width)).toBe(200);
		expect(Math.round(frame.height)).toBe(200);
	});

	test('the wheel zooms and the zoom is written after the pan', async ({ page }) => {
		await editor.loadContent('![cat|200x200](/test-fixtures/sample.png)\n');
		const widget = await selectAndStartCrop(page);
		const box = (await widget.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.wheel(0, -500);
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/!\[cat\|200x200@50,50,\d(?:\.\d+)?\]/);
		const src = await editor.bridge.getSource();
		const z = Number(/@50,50,([\d.]+)\]/.exec(src)![1]);
		expect(z).toBeGreaterThan(1);
		expect(z).toBeLessThanOrEqual(4);
	});

	test('an unframed image gains its rendered box as the frame on its first crop', async ({
		page
	}) => {
		await editor.loadContent('![cat|240](/test-fixtures/sample.png)\n');
		await selectAndStartCrop(page);
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/!\[cat\|240x\d+@50,50\]/);
	});

	test('Escape abandons the crop and restores the image untouched', async ({ page }) => {
		await editor.loadContent('![cat|200x200](/test-fixtures/sample.png)\n');
		const widget = await selectAndStartCrop(page);
		const before = await editor.bridge.getSource();
		const box = (await widget.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 4 });
		await page.mouse.up();
		await page.keyboard.press('Escape');
		await expect(page.locator('.md-image-crop-surface')).toHaveCount(0);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
		await expect(page.locator('[data-image-widget].md-image-cropped')).toHaveCount(0);
		// The grip returns with the toolbar.
		await expect(page.locator('.md-resize-handle')).toHaveCount(1);
	});

	test('dragging a corner bracket resizes the frame and so its aspect', async ({ page }) => {
		await editor.loadContent('![cat|200x200](/test-fixtures/sample.png)\n');
		const widget = await selectAndStartCrop(page);
		const corner = page.locator('[data-crop-corner="br"]');
		const cb = (await corner.boundingBox())!;
		const cx = cb.x + cb.width / 2;
		const cy = cb.y + cb.height / 2;
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		// Wider and shorter: the frame follows the pointer, the image stays in the flow.
		await page.mouse.move(cx + 100, cy - 50, { steps: 8 });
		await page.mouse.up();
		const live = (await widget.boundingBox())!;
		expect(Math.round(live.width)).toBe(300);
		expect(Math.round(live.height)).toBe(150);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('![cat|300x150@50,50]');
	});

	// The grip previewed on the <img>, which for a crop is the picture panned inside the frame,
	// not the box being resized: mid-drag it bulged out of its frame, and above zoom 1 the drag
	// started from the painted picture's width and jumped.
	test('the grip previews on the frame while resizing a cropped image', async ({ page }) => {
		await editor.loadContent('![cat|300x150@30,60,2](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();

		const geometry = () =>
			page.evaluate(() => {
				const w = document.querySelector('[data-image-widget]')!.getBoundingClientRect();
				const i = document.querySelector('[data-image-widget] img')!.getBoundingClientRect();
				return { fw: w.width, fh: w.height, iw: i.width, ih: i.height };
			});

		const before = await geometry();
		const hb = (await page.locator('.md-resize-handle').boundingBox())!;
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 6 });

		const during = await geometry();
		// The frame follows the pointer and keeps its shape...
		expect(during.fw).toBeGreaterThan(before.fw + 40);
		expect(during.fw / during.fh).toBeCloseTo(before.fw / before.fh, 2);
		// ...and the picture still covers it rather than spilling out.
		expect(during.iw).toBeGreaterThanOrEqual(during.fw - 1);
		expect(during.ih).toBeGreaterThanOrEqual(during.fh - 1);

		await page.mouse.up();
		// Not the loaded 300x150: a predicate the fixture already satisfies settles on nothing.
		await editor.bridge.waitForSourceMatches(/!\[cat\|(?!300x150)\d+x\d+@30,60,2\]/);
	});

	test('resizing a cropped image keeps the frame shape', async ({ page }) => {
		await editor.loadContent('![cat|200x100@30,60](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		const handle = page.locator('.md-resize-handle').first();
		const hb = (await handle.boundingBox())!;
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2, { steps: 8 });
		await page.mouse.up();
		await editor.bridge.waitForSourceMatches(/!\[cat\|(?!200x100)\d+x\d+@30,60\]/);
		const m = /!\[cat\|(\d+)x(\d+)@30,60\]/.exec(await editor.bridge.getSource())!;
		expect(Number(m[1])).toBeGreaterThan(200);
		expect(Math.abs(Number(m[1]) / Number(m[2]) - 2)).toBeLessThan(0.05);
	});

	test('a loaded crop survives its own commit byte for byte, and a pan is one undo away', async ({
		page
	}) => {
		const loaded = '![cat|200x100@30,60,1.5](/test-fixtures/sample.png)\n';
		await editor.loadContent(loaded);
		await selectAndStartCrop(page);
		await page.keyboard.press('Enter');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(loaded);
		await expect(page.locator('[data-image-widget].md-image-cropped')).toHaveCount(1);

		const widget = await selectAndStartCrop(page);
		const box = (await widget.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 6 });
		await page.mouse.up();
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/@(?!30,)\d+,60,1\.5\]/);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(loaded);
	});
});

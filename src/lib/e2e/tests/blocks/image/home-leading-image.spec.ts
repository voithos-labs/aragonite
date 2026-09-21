import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { clickWordSettled } from '../../presentation/helpers';
import { waitForFirstImageLoaded } from './helpers';

// Home before an image at the start of a line: the caret can sit before the widget, but no text
// node holds that position, so the browser puts the caret past the image and typing there is
// unreachable. Requirements: `e2e/requirements/blocks/image/home-leading-image.md`.

const IMAGE = '![pic](/test-fixtures/sample.png)';

async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

async function homeThenType(ep: EditorPage, page: Page): Promise<void> {
	await waitForFirstImageLoaded(page);
	await clickWordSettled(ep, page, 'tail');
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	await expect.poll(() => focusOffset(ep)).toBe(0);
	await page.keyboard.press('Z');
}

for (const mode of ['source', 'live'] as const) {
	test(`${mode}: Home puts the caret before the leading image, and a typed byte lands ahead of its bytes`, async ({
		page
	}) => {
		const ep = new EditorPage(page);
		await ep.goto(mode === 'live' ? '?presentationMode=live' : '');
		await ep.loadContent(`above\n\n${IMAGE} tail\n`);
		// An unwhitelisted param falls back to source, where this scenario passes without live.
		if (mode === 'live')
			await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');

		await homeThenType(ep, page);
		await ep.bridge.waitForSourceContains(`Z${IMAGE} tail`);
	});
}

// The branch for a container's marker prefix (GH #110) and the one for a leading widget agree.
test('a list item opening with an image lands Home before the image too', async ({ page }) => {
	const ep = new EditorPage(page);
	await ep.goto();
	await ep.loadContent(`- ${IMAGE} tail\n`);

	await homeThenType(ep, page);
	await ep.bridge.waitForSourceContains(`- Z${IMAGE} tail`);
});

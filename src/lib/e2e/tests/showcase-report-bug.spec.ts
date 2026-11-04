import { test, expect } from '../fixtures';
import { gotoReady } from '../goto-ready';
import { createClipboardArm, refuseNextClipboardWrite } from '../clipboard-arm';
import { edgeKey } from '../platform-keys';

// The showcase's "report a bug" button. This route has no `window.__test` bridge, so the cases
// read the rendered page, the tab it opens and the clipboard.
// Requirements: e2e/requirements/showcase-report-bug.md.

test.describe('/ showcase report a bug', () => {
	test.beforeEach(async ({ page }) => {
		// The new tab never reaches GitHub; it only has to open with the right address.
		await page
			.context()
			.route('https://github.com/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<title>bug form</title>' })
			);
		await gotoReady(page, '/');
	});

	test('asks before recording, and Cancel records nothing', async ({ page }) => {
		await page.getByTestId('report-bug').click();
		const card = page.getByTestId('report-card');
		await expect(card).toContainText("the whole document's text");
		await expect(card).toContainText('public');
		await card.getByRole('button', { name: 'Cancel' }).click();
		await expect(card).toHaveCount(0);
		await expect(page.getByTestId('report-bug')).toHaveText('report a bug');
	});

	test('a press outside leaves the card open, and Escape closes it only from the card', async ({
		page
	}) => {
		const button = page.getByTestId('report-bug');
		const card = page.getByTestId('report-card');
		await button.click();
		// A stray press must not throw away the privacy note before Start.
		await page.locator('[data-block-kind="paragraph"]').first().click();
		await expect(card).toBeVisible();

		// Escape typed in the editor is the editor's: the card stays and the caret keeps its focus.
		await page.keyboard.press('Escape');
		await expect(card).toBeVisible();
		await expect(page.locator('.editor :focus')).toHaveCount(1);

		// A press on the card's text leaves focus on nothing, which still counts as the card's.
		await card.locator('p').first().click();
		await page.keyboard.press('Escape');
		await expect(card).toHaveCount(0);
		await expect(button).toBeFocused();
	});

	test('records with text, then on stop opens the bug form with the recording on the clipboard', async ({
		page
	}) => {
		await page.getByTestId('report-bug').click();
		await page.getByRole('button', { name: 'Start recording' }).click();
		await expect(page.getByTestId('report-bug')).toContainText('stop and report');

		await page.locator('[data-block-kind="paragraph"]').first().click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type('zq');

		const tab = page.context().waitForEvent('page');
		await page.getByTestId('report-bug').click();
		const popup = await tab;
		await popup.waitForURL(/github\.com\/voithos-labs\/aragonite\/issues\/new/);
		const url = new URL(popup.url());
		expect(url.origin + url.pathname).toBe('https://github.com/voithos-labs/aragonite/issues/new');
		expect(url.searchParams.get('template')).toBe('bug.yml');
		expect(url.searchParams.get('where')).toMatch(
			/^\d+\.\d+\.\d+, (Chrome|Firefox|Safari) [\d.]+ on \w+, live mode$/
		);
		// The recording rides the clipboard, never the link.
		expect(url.searchParams.get('recording')).toContain('on your clipboard');
		await expect(page.getByTestId('report-card')).toContainText('on your');

		// The system clipboard on Windows hands the line breaks back as CRLF.
		const clip = await createClipboardArm(page).read();
		const recording = JSON.parse(clip.replace(/^```json\r?\n|\r?\n```$/g, ''));
		expect(recording.text).toBe(true);
		expect(recording.steps.at(-1).after.splice[2]).toBe('q');
		expect(recording.editor.presentationMode).toBe('live');
	});

	test('on a phone-width screen the card stays inside the viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByTestId('report-bug').click();
		const box = await page.getByTestId('report-card').boundingBox();
		expect(box?.x).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
	});

	test('a copy the browser refuses gets a Copy recording button that copies on its own click', async ({
		page
	}) => {
		await page.getByTestId('report-bug').click();
		await page.getByRole('button', { name: 'Start recording' }).click();
		await page.locator('[data-block-kind="paragraph"]').first().click();
		await page.keyboard.type('k');
		await refuseNextClipboardWrite(page);

		const tab = page.context().waitForEvent('page');
		await page.getByTestId('report-bug').click();
		await tab;
		const card = page.getByTestId('report-card');
		await expect(card).toContainText('kept the recording off your clipboard');
		await card.getByRole('button', { name: 'Copy recording' }).click();
		await expect(card).toContainText('the recording is on your clipboard');
		expect(await createClipboardArm(page).read()).toContain('aragonite-input-recording/1');
	});
});

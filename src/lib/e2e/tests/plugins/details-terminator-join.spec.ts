import { test, expect } from '../../fixtures';
import { DetailsPage, capturedErrors } from './details-helpers';
import { readDoc, roundTripStable } from './helpers';

// A join inside a details body that spells `</details>` from two lines must be escaped, or it
// closes the container on reload. Requirements: details-terminator-join.md.

const SPLIT_TAG = '<details open>\n<summary>T</summary>\n\n</det\n\nails>\n\n</details>\n';
const JOINED = '<details open>\n<summary>T</summary>\n\n&lt;/details>\n\n</details>\n';

test.describe('plugin container: <details> terminator escape on a join', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
		await editor.loadContent(SPLIT_TAG);
	});

	test('Backspace at the start of the second line escapes the tag it forms', async ({ page }) => {
		await page.locator('.details-block [contenteditable="true"]', { hasText: 'ails>' }).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals(JOINED);
		expect((await readDoc(page)).kinds).toEqual(['details']);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Delete at the end of the first line escapes the tag it forms', async ({ page }) => {
		await page.locator('.details-block [contenteditable="true"]', { hasText: '</det' }).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Delete');

		await editor.bridge.waitForSourceEquals(JOINED);
		expect((await readDoc(page)).kinds).toEqual(['details']);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

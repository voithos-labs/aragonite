import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { DetailsPage, capturedErrors, readDetails, OPEN } from './details-helpers';
import { readDoc, roundTripStable } from './helpers';

/**
 * The paste half of the `</details>` terminator escape (GH #40): the clipboard is the one
 * byte door a body reaches without a node-ops sink, so the container's `bodyWrite` escape
 * must fire inside the paste path. Requirements: details-terminator-paste.md.
 */

test.describe('plugin container: <details> terminator escape on paste', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('pasting a clipboard bearing </details> into the body keeps the container, escaped', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		await editor.seedClipboard('steps:\n\n</details>\n\nafter\n');
		await editor.paste(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains('&lt;/details>');
		expect((await readDoc(page)).kinds).toEqual(['details']);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('pasting a balanced details example nests verbatim, unescaped', async ({ page }) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4);
		await editor.seedClipboard('<details>\n<summary>inner</summary>\n\nnested\n\n</details>\n');
		await editor.paste(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains('<summary>inner</summary>');
		expect((await readDetails(page, 0)).childKinds).toContain('details');
		expect(await editor.bridge.getSource()).not.toContain('&lt;');
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

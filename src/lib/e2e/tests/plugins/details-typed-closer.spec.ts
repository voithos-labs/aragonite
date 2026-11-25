import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { DetailsPage, capturedErrors } from './details-helpers';
import { edgeKey } from '../../platform-keys';
import { textRunEnd } from '../../text-runs';

// A closing tag typed under an unclosed `<details>`, one key at a time
// (`requirements/plugins/details-typed-closer.md`): only the exact spelling closes it.

const WAITING = '<details>\n<summary>Sum</summary>\nBody\n';

let editor: DetailsPage;

async function topKinds(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		(window as any).__test.getDocument().children.map((n: { kind: string }) => n.kind)
	);
}

/** Types `tag` on a new line under `Body`, returning the top-level kinds after each key. */
async function typeUnderBody(page: Page, tag: string): Promise<string[][]> {
	const end = await textRunEnd(page, 'Body');
	await page.mouse.click(end.x, end.y);
	await page.keyboard.press(edgeKey('lineEnd'));
	await page.keyboard.press('Enter');
	const kinds: string[][] = [];
	for (let i = 1; i <= tag.length; i++) {
		await page.keyboard.type(tag[i - 1]);
		await editor.bridge.waitForSourceContains(tag.slice(0, i));
		kinds.push(await topKinds(page));
	}
	return kinds;
}

test.beforeEach(async ({ page }) => {
	editor = new DetailsPage(page);
	await editor.gotoDetails();
});

for (const mode of ['source', 'live'] as const) {
	test(`(${mode}) </details> typed key by key forms the section on its last key`, async ({
		page
	}) => {
		await editor.setPresentationMode(mode);
		await editor.loadContent(WAITING);

		const kinds = await typeUnderBody(page, '</details>');
		expect(kinds.slice(0, -1).filter((top) => top.includes('details/details'))).toEqual([]);
		expect(kinds.at(-1)).toEqual(['details/details']);
		expect(await editor.bridge.getSource()).toBe(`${WAITING}\n</details>\n`);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test(`(${mode}) </DETAILS> typed key by key stays HTML`, async ({ page }) => {
		await editor.setPresentationMode(mode);
		await editor.loadContent(WAITING);

		const kinds = await typeUnderBody(page, '</DETAILS>');
		expect(kinds.filter((top) => top.includes('details/details'))).toEqual([]);
		expect(await editor.bridge.getSource()).toBe(`${WAITING}\n</DETAILS>\n`);
		expect(await capturedErrors(page)).toEqual([]);
	});
}

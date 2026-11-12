import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// A selection that runs out of a closed `<details>` takes it whole, hidden body and all
// (`requirements/plugins/details-range-removal.md`). Bytes per shape and route are the unit
// suites' (`test/selection/range-end-narrowing.test.ts`, `test/selection/cross-block/
// range-holds-whole.test.ts`).

const CLOSED = '<details>\n<summary>Sum</summary>\n\nbody\n\n</details>';
const OPEN = '<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>';

let editor: PluginsPage;

async function open(mode: 'live' | 'source', source: string): Promise<void> {
	await editor.gotoPlugins();
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
}

/** The caret at the end of the summary at `path`, then one Shift+ArrowRight out of it. */
async function outOfSummary(path: number[]): Promise<void> {
	await editor.clickBlockAtPath(path, 3);
	await editor.page.keyboard.press('Shift+ArrowRight');
	await editor.waitForCrossBlock(true);
}

test.beforeEach(({ page }) => {
	editor = new PluginsPage(page);
});

test.describe('a selection out of a closed summary', () => {
	for (const mode of ['live', 'source'] as const) {
		for (const key of ['Backspace', 'Delete', 'ControlOrMeta+x']) {
			test(`(${mode}) ${key} takes the details whole, and a letter joins the paragraph`, async ({
				page
			}) => {
				await open(mode, `${CLOSED}\n\npara\n`);
				await outOfSummary([0, 0]);

				await page.keyboard.press(key);
				await editor.bridge.waitForSourceEquals('para\n');
				await page.keyboard.type('x');
				await editor.bridge.waitForSourceEquals('xpara\n');
			});
		}

		test(`(${mode}) a copy holds the hidden body`, async ({ page }) => {
			await open(mode, `${CLOSED}\n\npara\n`);
			await outOfSummary([0, 0]);

			await page.keyboard.press('ControlOrMeta+c');
			await editor.clipboard.waitForContains('</details>', 5000);
			expect(await editor.clipboard.read()).toBe(CLOSED);
		});
	}

	test('a letter typed over it leaves no part of the details', async ({ page }) => {
		await open('live', `${CLOSED}\n\npara\n`);
		await outOfSummary([0, 0]);

		await page.keyboard.type('x');
		await editor.bridge.waitForSourceContains('x');
		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/summary|details|body/);
		expect(source.replace(/\n{3,}/g, '\n\n')).toBe('x\n\npara\n');
	});

	test('one undo puts the details back', async ({ page }) => {
		await open('live', `${CLOSED}\n\npara\n`);
		await outOfSummary([0, 0]);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('para\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(`${CLOSED}\n\npara\n`);
	});

	test('(live) inside an untitled `:::note`, Backspace and a letter join the paragraph', async ({
		page
	}) => {
		await open('live', `:::note\n${CLOSED}\n\npara\n:::\n`);
		await outOfSummary([0, 1, 0]);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(':::note\n\npara\n:::\n');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals(':::note\n\nxpara\n:::\n');
	});

	test('(live) inside an untitled `:::note`, Enter opens a line above the paragraph', async ({
		page
	}) => {
		await open('live', `:::note\n${CLOSED}\n\npara\n:::\n`);
		await outOfSummary([0, 1, 0]);

		await page.keyboard.press('Enter');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceContains('x');
		expect(await editor.bridge.getSource()).toBe(':::note\n\n\nxpara\n:::\n');
	});
});

test.describe('a selection across a container to a block it can’t join', () => {
	for (const [name, block] of [
		['an open details', OPEN],
		['a `:::note`', ':::note\nbody\n:::']
	]) {
		test(`(source) Backspace takes ${name} whole`, async ({ page }) => {
			await open('source', `abc\n\n${block}\n\n# h\n`);
			await editor.clickBlockAtPath([0], 1);
			await editor.shiftClickBlock([2], 0);
			await editor.waitForCrossBlock(true);

			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('a\n\n# h\n');
		});
	}
});

test('a selection out of an open summary keeps the details', async ({ page }) => {
	await open('live', `${OPEN}\n\npara\n`);
	await editor.clickBlockAtPath([0, 0], 1);
	await editor.shiftClickBlock([1], 0);
	await editor.waitForCrossBlock(true);

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceEquals(
		'<details open>\n<summary>S</summary>\n\n\n</details>\n\npara\n'
	);
});

import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A bullet marker typed at the start of a last paragraph with no final line break turns it into
// one list item, and the commit's dev checks stay quiet (the fixture fails on any warning).

const SEEDS = [
	{ shape: 'a lone paragraph', seed: 'para', block: 0, expected: '- xpara' },
	{
		shape: 'a paragraph after a blank line',
		seed: 'a\n\npara',
		block: 1,
		expected: 'a\n\n- xpara'
	},
	{
		shape: 'a CRLF paragraph after a blank line',
		seed: 'a\r\n\r\npara',
		block: 1,
		expected: 'a\r\n\r\n- xpara'
	}
];

const MODES = ['source', 'live'] as const;

// Typing on an unterminated last line adds a line ending today (#616), so the checks trim it.
const trimEnding = (source: string) => source.replace(/\r?\n$/, '');

test.describe('text editing, a bullet typed into an unterminated last line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		for (const { shape, seed, block, expected } of SEEDS) {
			test(`\`- \` before ${shape} makes one list item (${mode})`, async ({ page }) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(seed);
				expect(await editor.bridge.getSource()).toBe(seed);
				await editor.focusBlockStart(block);
				await page.keyboard.type('- ');
				await page.keyboard.type('x');

				await expect.poll(async () => trimEnding(await editor.bridge.getSource())).toBe(expected);
				expect(await editor.bridge.getBlockCount()).toBe(block + 1);
				expect(await editor.bridge.getBlockKind(block)).toBe('list');
				expect(await editor.parseConverged()).toBe(true);
			});
		}
	}
});

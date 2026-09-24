import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// A list long enough that only part of it is mounted, then a paragraph below it. Each gesture
// moves the paragraph into the list's last item, and the key after it must land there.
// Requirements: `e2e/requirements/blocks/list/join-into-long-list.md`.

const ITEMS = 150;
const LIST = Array.from({ length: ITEMS }, (_, i) => `- item ${i}\n`).join('');
const LAST = `- item ${ITEMS - 1}\n`;

const JOINS = [
	{ gesture: 'two typed spaces', typed: '  ', tail: `${LAST}\n  Qzz\n` },
	{ gesture: 'two pasted spaces', pasted: '  ', tail: `${LAST}\n  Qzz\n` },
	{ gesture: 'four typed spaces', typed: '    ', tail: `${LAST}\n    Qzz\n` },
	{ gesture: 'Backspace', pressed: 'Backspace', tail: `- item ${ITEMS - 1}Qzz\n` }
];

test.describe('a paragraph joined into the last item of a long list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of ['source', 'live'] as const) {
		for (const { gesture, typed, pasted, pressed, tail } of JOINS) {
			test(`${mode}: the key after ${gesture} lands in the joined paragraph`, async ({ page }) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(`${LIST}\nzz\n`);
				if (pasted) await editor.seedClipboard(pasted);
				await editor.focusBlockAtPath([1], 0);
				if (pasted) await editor.paste();
				else if (pressed) await page.keyboard.press(pressed);
				else await page.keyboard.type(typed ?? '');
				await page.keyboard.type('Q');

				await expect
					.poll(async () => (await editor.bridge.getSource()).slice(-tail.length))
					.toBe(tail);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
	}
});

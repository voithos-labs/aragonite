import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { nextRow } from '../presentation/helpers';

// A file with no final line break keeps that through being emptied: the next letter stands with
// no break after it (`requirements/text-editing/emptied-open-document.md`). The fixture fails on
// any dev warning, so the last-line check warning about an emptied document fails the test.

const MODES = ['source', 'live'] as const;

const SOURCES = [
	{ ending: 'LF', source: 'lead\n\n- one\n- two\n\ntail' },
	{ ending: 'CRLF', source: 'lead\r\n\r\n- one\r\n- two\r\n\r\ntail' }
];

/** The source with `\r` and `\n` spelled out, so a diff shows a final break. */
const escaped = (source: string) => JSON.stringify(source);

/** The source's lines, whatever ends them. */
const textOf = (source: string) => source.split(/\r?\n/).join('\n').replace(/\n$/, '');

test.describe('text editing, a file with no final line break, emptied', () => {
	for (const mode of MODES) {
		for (const { ending, source } of SOURCES) {
			test(`the next letter stands with no line break (${mode}, ${ending})`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode(mode);

				const selectEverything = async () => {
					await nextRow(editor, source);
					await editor.focusBlockStart(0);
					await editor.selectAll();
					await editor.selectAll();
					await editor.waitForCrossBlock(true);
				};
				const expectSource = (expected: string) =>
					expect.poll(async () => escaped(await editor.bridge.getSource())).toBe(escaped(expected));

				await test.step('everything deleted, then a letter', async () => {
					await selectEverything();
					await page.keyboard.press('Backspace');
					await expectSource('');
					await page.keyboard.type('x');
					await expectSource('x');
				});

				await test.step('a letter typed over everything', async () => {
					await selectEverything();
					await page.keyboard.type('x');
					await expectSource('x');
				});

				await test.step('everything cut, then pasted back', async () => {
					await selectEverything();
					await page.keyboard.press('ControlOrMeta+x');
					await expectSource('');
					await editor.paste();
					// Which line endings a paste into an empty file writes is its own rule, so this row
					// reads the text alone.
					await expect
						.poll(async () => textOf(await editor.bridge.getSource()))
						.toBe(textOf(source));
				});

				await test.step('an undo back to the emptied file, then a letter', async () => {
					await selectEverything();
					await page.keyboard.press('Backspace');
					await page.keyboard.type('x');
					await expectSource('x');
					await editor.undo();
					await expectSource('');
					await page.keyboard.type('y');
					await expectSource('y');
				});
			});
		}
	}
});

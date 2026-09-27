import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { pointAtRaw } from '../../../text-runs';

// A click in the room around a code block's lines lands on the nearest line of code.
// Requirements: `e2e/requirements/blocks/code/padding-click.md`.

const DOC = 'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\nAfter\n';
// Raw offsets inside block [1]: `con|st` on the first line of code, `foo|()` on the last.
const FIRST_LINE_AT = 9;
const LAST_LINE_AT = 22;

const ROWS = [
	{ edge: 'top', offset: FIRST_LINE_AT, typed: '```js\nconZst x = 1;\nfoo();\n```' },
	{ edge: 'bottom', offset: LAST_LINE_AT, typed: '```js\nconst x = 1;\nfooZ();\n```' }
] as const;

for (const mode of ['live', 'preview-block']) {
	for (const row of ROWS) {
		test(`${mode}: a click in the ${row.edge} padding lands on the nearest line of code`, async ({
			page
		}) => {
			const editor = new EditorPage(page);
			await editor.goto(`?presentationMode=${mode}`);
			await editor.loadContent(DOC);
			await editor.focusBlockEnd(0);

			// The column comes from where the editor put that character; the row is the strip the
			// block keeps above and below its grey box, outside the text element.
			const column = await pointAtRaw(page, [1], row.offset);
			const box = await page.locator(`[data-block-path='[1]']`).boundingBox();
			if (!box) throw new Error('the code block has no box');
			const y = row.edge === 'top' ? box.y + 3 : box.y + box.height - 3;
			await page.mouse.click(column.x, y);
			await editor.waitForRenderFlush();
			await page.keyboard.type('Z');

			await editor.bridge.waitForSourceContains(row.typed);
			expect(await editor.bridge.getSource()).toBe(DOC.replace(/```js[^]*```/, row.typed));
		});
	}
}

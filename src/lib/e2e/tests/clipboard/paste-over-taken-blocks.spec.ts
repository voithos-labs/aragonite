import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A paste over a range that takes its blocks whole and leaves no text of its own lands where they
// were, as blocks of its own (`requirements/clipboard/paste-over-taken-blocks.md`).

const DOC = 'first\n\n***\n\n# head\n\nlast\n';

const ROWS = [
	{ name: 'one line stands in a paragraph of its own', clip: 'Q', after: 'first\n\nQ\n\nlast\n' },
	{
		name: 'two paragraphs stand apart from the paragraph after',
		clip: 'one\n\ntwo',
		after: 'first\n\none\n\ntwo\n\nlast\n'
	}
];

for (const mode of ['live', 'source'] as const)
	test.describe(`a paste over a divider and a heading taken whole, ${mode}`, () => {
		for (const row of ROWS)
			test(row.name, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(DOC);
				await editor.focusBlockEnd(0);
				await editor.bridge.setSelection({
					anchor: { path: [1], offset: 0 },
					focus: { path: [2], offset: 6 }
				});
				await editor.clipboard.seed(row.clip);
				await editor.clipboard.paste();
				await editor.bridge.waitForSourceEquals(row.after);
			});
	});

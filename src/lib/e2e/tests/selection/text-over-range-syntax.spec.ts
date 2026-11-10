import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { attachIme } from '../../simulation/ime';

// Text typed, pasted or composed over a range that took the block it started in goes where the
// range was: never into the syntax of the block beside it (requirements/selection/).

type Gesture = 'type' | 'paste' | 'composition';

interface Row {
	name: string;
	source: string;
	/** The page whose plugins read the block as its kind; the built-in harness otherwise. */
	plugin?: 'latex' | 'mermaid';
	/** The document once `text` lands. */
	after(text: string): string;
	/** Where the text lands: the block holding the caret after it, and that block's kind. */
	landed: { path: number[]; kind: string };
	/** The kept block: its path and kind once the text landed. */
	kept: { path: number[]; kind: string };
}

const TABLE = '| c |\n| - |\n\n';
const TWO_TABLES = '| c |\n| - |\n\n| d |\n| - |\n';

/** A one-row table, then `block`: the range takes the table and stops at the block's first byte. */
function below(name: string, block: string, kind: string, plugin?: Row['plugin']): Row {
	return {
		name: `${name} below`,
		source: `${TABLE}${block}\n`,
		plugin,
		after: (text) => `${text}\n\n${block}\n`,
		landed: { path: [0], kind: 'paragraph' },
		kept: { path: [1], kind }
	};
}

/** `block`, then two one-row tables the range takes whole: the caret falls back on the block's end. */
function above(name: string, block: string, kind: string): Row {
	return {
		name: `${name} above`,
		source: `${block}\n\n${TWO_TABLES}`,
		after: (text) => `${block}\n\n${text}\n`,
		landed: { path: [1], kind: 'paragraph' },
		kept: { path: [0], kind }
	};
}

/** A block whose first text byte the caret lands on: the range's text joins it there. */
function joins(
	name: string,
	block: string,
	joined: (text: string) => string,
	landed: Row['landed']
): Row {
	return {
		name: `a ${name} below joins`,
		source: `${TABLE}${block}\n`,
		after: (text) => `${joined(text)}\n`,
		landed,
		kept: landed
	};
}

const ROWS: Row[] = [
	below('a heading', '# Head', 'heading'),
	below('a code block', '```js\nbody\n```', 'fencedCode'),
	below('an HTML block', '<div>\nhi\n</div>', 'htmlBlock'),
	below('an indented code block', '    code', 'indentedCode'),
	below('a rule', '---', 'thematicBreak'),
	below('a math block', '$$x^2$$', 'mathBlock', 'latex'),
	below('a diagram', '```mermaid\ngraph TD\n```', 'mermaid', 'mermaid'),
	{
		name: 'a code block opening a list item below',
		source: `${TABLE}- \`\`\`js\n  body\n  \`\`\`\n`,
		after: (text) => `${text}\n\n- \`\`\`js\n  body\n  \`\`\`\n`,
		landed: { path: [0], kind: 'paragraph' },
		kept: { path: [1, 0, 0], kind: 'fencedCode' }
	},
	{
		name: 'a heading below, both inside a quote',
		source: '> | c |\n> | - |\n>\n> # Head\n',
		after: (text) => `> ${text}\n>\n> # Head\n`,
		landed: { path: [0, 0], kind: 'paragraph' },
		kept: { path: [0, 1], kind: 'heading' }
	},
	above('a code block', '```js\nbody\n```', 'fencedCode'),
	above('a rule', '---', 'thematicBreak'),
	joins('paragraph', 'plain', (text) => `${text}plain`, { path: [0], kind: 'paragraph' }),
	joins('setext heading', 'Head\n===', (text) => `${text}Head\n===`, {
		path: [0],
		kind: 'setextHeading'
	}),
	// The range takes the quote's marker and the item's, so the text joins at the table's level.
	joins('quote', '> q', (text) => `${text}q`, { path: [0], kind: 'paragraph' }),
	joins('list', '- li', (text) => `${text}li`, { path: [0], kind: 'paragraph' })
];

const GESTURES: Gesture[] = ['type', 'paste', 'composition'];

/** The text each gesture puts down: a key, a clipboard, an IME's converted commit. */
const TEXT: Record<Gesture, string> = { type: 'x', paste: 'x', composition: '漢' };

async function apply(editor: EditorPage, gesture: Gesture): Promise<void> {
	if (gesture === 'type') return editor.typeSlowly(TEXT.type);
	if (gesture === 'paste') {
		await editor.seedClipboard(TEXT.paste);
		return editor.paste();
	}
	const ime = await attachIme(editor.page);
	await ime.compose('か');
	await ime.commit(TEXT.composition);
}

async function kindAt(editor: EditorPage, path: number[]): Promise<string | undefined> {
	return editor.page.evaluate((p) => {
		let node = (window as any).__test.getDocument();
		for (const i of p) node = node?.children?.[i];
		return node?.kind as string | undefined;
	}, path);
}

// Live mode hides the heading's `#` and the fence lines, so the caret the IME composes at differs.
for (const mode of ['source', 'live'] as const) {
	for (const row of ROWS) {
		for (const gesture of GESTURES) {
			test(`${row.name} (${mode}): ${gesture} over the range lands where the range was`, async ({
				page
			}) => {
				const editor = row.plugin ? new PluginsPage(page) : new EditorPage(page);
				if (editor instanceof PluginsPage) await editor.gotoPlugins(row.plugin);
				else await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.source);
				await page.locator('.table-cell').first().click();
				await page.keyboard.press('Shift+ArrowDown');
				await editor.waitForCrossBlock(true);
				const range = await editor.bridge.getSelection();

				await apply(editor, gesture);
				const text = TEXT[gesture];
				await expect.poll(() => editor.bridge.getSource()).toBe(row.after(text));
				expect(await kindAt(editor, row.landed.path)).toBe(row.landed.kind);
				expect(await kindAt(editor, row.kept.path)).toBe(row.kept.kind);
				const caret = { path: row.landed.path, offset: text.length };
				expect(await editor.bridge.getSelection()).toEqual({ anchor: caret, focus: caret });

				// The removal, the opened paragraph and the text are one undo entry.
				await editor.undo();
				await editor.bridge.waitForSourceEquals(row.source);
				await editor.waitForCrossBlock(true);
				expect(await editor.bridge.getSelection()).toEqual(range);
			});
		}
	}
}

test('an abandoned composition over the range leaves the removal and the paragraph it opened', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(`${TABLE}# Head\n`);
	await page.locator('.table-cell').first().click();
	await page.keyboard.press('Shift+ArrowDown');
	await editor.waitForCrossBlock(true);
	const ime = await attachIme(page);

	await ime.compose('か');
	await ime.abort();

	await editor.waitForNoSourceMutation();
	expect(await editor.bridge.getSource()).toBe('\n# Head\n');
	expect(await kindAt(editor, [0])).toBe('paragraph');
	expect(await kindAt(editor, [1])).toBe('heading');
});

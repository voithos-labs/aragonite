import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Each row's trailing paragraph merges into the deepest prose leaf above it, and the typed `!`
// says where the caret landed: at the join, never at the container's end.
const JOINS = [
	{
		name: 'inside the merged blockquote leaf (not at container end)',
		doc: '> > nested\n>\n> trailing\n',
		lead: 'nested'
	},
	{
		// A 2-level-deep nested blockquote, so the Backspace exercises `focusByPath`'s
		// `path.length === 2` branch inside the nested merge path.
		name: 'when merge target is two containers deep',
		doc: '> > > deep\n>\n> trailing\n',
		lead: 'deep'
	},
	{
		name: 'when prev sibling is a list inside a blockquote',
		doc: '> - item\n>\n> trailing\n',
		lead: 'item'
	},
	{
		name: 'when prev sibling is a list inside a list item',
		doc: '- outer\n\n  - inner\n\n  trailing\n',
		lead: 'inner'
	}
];

test.describe('inner container+paragraph merge inside a container', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function backspaceAtStartOfTrailing(): Promise<void> {
		const trailing = editor.page.locator('[contenteditable="true"]', { hasText: /^trailing$/ });
		await trailing.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
	}

	test('Backspace in trailing paragraph inside blockquote merges into deepest prose leaf of preceding nested blockquote', async () => {
		await editor.loadContent('> one\n>\n> > nested\n>\n> three\n');
		const three = editor.page.locator('[contenteditable="true"]', { hasText: /^three$/ });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/nestedthree/);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> one$/m);
		expect(source).not.toMatch(/^three$/m);
		expect(source).not.toMatch(/^> three$/m);
	});

	for (const { name, doc, lead } of JOINS) {
		test(`caret lands at the join point ${name}`, async () => {
			await editor.loadContent(doc);
			await backspaceAtStartOfTrailing();
			await editor.bridge.waitForSourceMatches(new RegExp(`${lead}trailing`));

			await editor.typeText('!');
			await editor.bridge.waitForSourceMatches(new RegExp(`${lead}!trailing`));

			expect(await editor.bridge.getSource()).not.toMatch(new RegExp(`${lead}trailing!`));
		});
	}
});

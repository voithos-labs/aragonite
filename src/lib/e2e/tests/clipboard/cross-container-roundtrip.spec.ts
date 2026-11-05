import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard: cross-container round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('copy from blockquote inner paragraph, paste into top-level paragraph', async () => {
		await editor.loadContent('> inside bq\n\ntarget para\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([0, 0], 'inside bq'.length);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		await editor.focusBlockAtPath([1], 'target para'.length);
		await editor.paste();
		await editor.bridge.waitForSourceContains('target parainside bq');

		const src = await editor.bridge.getSource();
		expect(src).toContain('target parainside bq');
		expect(src).toMatch(/> inside bq/);
	});

	test('copy a paragraph, paste into blockquote inner paragraph (structural preserves blockquote marker)', async () => {
		await editor.loadContent('outer para\n\n> target inside bq\n');

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([0], 'outer para'.length);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		await editor.focusBlockAtPath([1, 0], 'target inside bq'.length);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/> target inside bqouter para/);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/> target inside bqouter para/);
	});

	test('copy across container boundary (blockquote → top-level), paste into fresh document', async () => {
		await editor.loadContent('> bq content\n\nouter para\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([1], 'outer para'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		await editor.loadContent('destination\n');
		await editor.focusBlockAtPath([0], 'destination'.length);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/destination[\s\S]*outer para/);

		const src = await editor.bridge.getSource();
		expect(src).toContain('bq content');
		expect(src).toMatch(/destination[\s\S]*outer para/);
	});
});

// A cut then a paste at the caret it left gives the document back; until the paste joins its
// first and last blocks to the text around the caret, each row is expected to fail.
const CUT_AND_PASTE_BACK: {
	name: string;
	doc: string;
	from: [number[], number];
	to: [number[], number];
}[] = [
	{ name: 'two paragraphs', doc: 'alpha bravo\n\ncharlie delta\n', from: [[0], 6], to: [[1], 8] },
	{
		name: 'a paragraph into a nested quote',
		doc: 'alpha bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you set out for Ithaka\n> > hope your road is a long one,\n',
		from: [[0], 6],
		to: [[1, 1, 0], 7]
	},
	{
		name: 'a quote out to a paragraph',
		doc: '> one two\n> three\n\nafter para\n',
		from: [[0, 0], 4],
		to: [[1], 3]
	},
	{
		name: 'a list item out to a paragraph',
		doc: '- one two\n- three\n\nafter\n',
		from: [[0, 0, 0], 4],
		to: [[1], 3]
	}
];

test.describe('clipboard: a cut pasted back in place', () => {
	for (const row of CUT_AND_PASTE_BACK) {
		test(`#818 ${row.name}: cut then paste gives the document back`, async ({ page }) => {
			test.fail();
			const editor = new EditorPage(page);
			await editor.goto('?presentationMode=live');
			await editor.loadContent(row.doc);
			await editor.clickBlockAtPath(...row.from);
			await editor.shiftClickBlock(...row.to);
			await editor.waitForCrossBlock(true);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.waitForClipboardWrite();
			await editor.paste();
			await editor.bridge.waitForSourceEquals(row.doc, 3000);
		});
	}
});

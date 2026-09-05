import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// One invariant across selection shapes: copying a list selection and pasting it back over
// itself reconstructs the original structure exactly — no nested sub-list, no content loss.
const ORDERED = '1. one\n2. two\n3. three\n';

const ROUNDTRIPS: {
	name: string;
	doc: string;
	from: [number[], number];
	to: [number[], number];
}[] = [
	{
		name: 'mid-one to end-of-three (offset 5)',
		doc: ORDERED,
		from: [[0, 0, 0], 1],
		to: [[0, 2, 0], 5]
	},
	{
		name: 'mid-one to mid-three (offset 4): residue reattaches',
		doc: ORDERED,
		from: [[0, 0, 0], 1],
		to: [[0, 2, 0], 4]
	},
	{
		name: 'mid-one to end-of-two (two-item partial)',
		doc: ORDERED,
		from: [[0, 0, 0], 1],
		to: [[0, 1, 0], 3]
	},
	{
		name: '3-item list, select items 1-2 whole',
		doc: ORDERED,
		from: [[0, 0, 0], 0],
		to: [[0, 1, 0], 3]
	},
	{
		name: '2-item list, select all',
		doc: '1. one\n2. two\n',
		from: [[0, 0, 0], 0],
		to: [[0, 1, 0], 3]
	},
	{
		name: 'unordered list, items 1-2',
		doc: '- alpha\n- beta\n- gamma\n',
		from: [[0, 0, 0], 0],
		to: [[0, 1, 0], 4]
	}
];

test.describe('copy-paste round-trip: list selections preserve structure', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const { name, doc, from, to } of ROUNDTRIPS) {
		test(`${name}: exact round-trip`, async () => {
			await editor.loadContent(doc);

			await editor.focusBlockAtPath(...from);
			await editor.shiftClickBlock(...to);
			await editor.waitForCrossBlock(true);

			await editor.page.keyboard.press('ControlOrMeta+c');
			await editor.waitForClipboardWrite();
			await editor.paste();
			// The round-trip's end state IS its start state, so no source predicate can
			// observe the paste. The selection collapsing is the one real transition.
			await editor.waitForCrossBlock(false);

			expect((await editor.bridge.getSource()).trim()).toBe(doc.trim());
		});
	}

	test('pasting external list content (pre-staged clipboard) into a list also flattens', async () => {
		await editor.loadContent('- target one\n- target two\n');
		await editor.seedClipboard('- pasted a\n- pasted b\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'target two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceMatches(/- pasted a\n- pasted b/);

		const src = await editor.bridge.getSource();
		// Windows clipboard stores CRLF even when written with LF.
		expect(src.replace(/\r\n/g, '\n').trim()).toBe('- pasted a\n- pasted b');
	});
});

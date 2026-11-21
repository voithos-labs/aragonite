import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Requirements: `e2e/requirements/selection/range-removal-apart.md`.

interface Host {
	name: string;
	source: string;
	/** Puts the range down from the taken block's first byte to inside the paragraph below. */
	select: (editor: EditorPage) => Promise<void>;
	removed: string;
	lettered: string;
	typed: string;
	modes: readonly ('source' | 'live')[];
}

const HOSTS: Host[] = [
	{
		name: 'a divider',
		source: 'first\n***\n\npara\n',
		select: async (e) => {
			// A drag across the divider holds it whole; a Shift+click then carries the range on.
			await e.holdBlockWhole('.thematic-break-block');
			await e.shiftClickBlock([2], 2);
		},
		removed: 'first\n\nra\n',
		lettered: 'first\n\nxra\n',
		typed: 'first\n\nQra\n',
		modes: ['source', 'live']
	},
	{
		name: 'a heading',
		source: 'first\n# head\n\npara\n',
		select: async (e) => {
			await e.focusBlockAtPath([1], 0);
			await e.shiftClickBlock([2], 2);
		},
		removed: 'first\n\nra\n',
		lettered: 'first\n\nxra\n',
		typed: 'first\n\nQra\n',
		modes: ['source']
	},
	{
		name: 'a fence',
		source: 'Run this:\n```sh\nnpm i\n```\n\nThen do that.\n',
		select: async (e) => {
			await e.focusBlockAtPath([1], 0);
			await e.shiftClickBlock([2], 5);
		},
		removed: 'Run this:\n\ndo that.\n',
		lettered: 'Run this:\n\nxdo that.\n',
		typed: 'Run this:\n\nQdo that.\n',
		modes: ['source']
	}
];

test.describe('a removal keeps a blank line the range took above the rest it leaves', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const host of HOSTS)
		for (const mode of host.modes) {
			test(`Delete, then a letter, over ${host.name} flush under a paragraph (${mode})`, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(host.source);
				await host.select(editor);
				await editor.waitForCrossBlock(true);

				await editor.page.keyboard.press('Delete');
				await expect.poll(() => editor.bridge.getSource()).toBe(host.removed);
				await editor.typeSlowly('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(host.lettered);
				expect(await editor.parseConverged()).toBe(true);
			});

			test(`a typed letter over ${host.name} flush under a paragraph (${mode})`, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(host.source);
				await host.select(editor);
				await editor.waitForCrossBlock(true);

				await editor.typeSlowly('Q');

				await expect.poll(() => editor.bridge.getSource()).toBe(host.typed);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
});

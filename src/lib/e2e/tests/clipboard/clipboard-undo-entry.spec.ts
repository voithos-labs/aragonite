import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { textRunCenter } from '../../text-runs';

// A cut or a paste is its own undo entry, apart from the typing on either side.
// Requirements: `e2e/requirements/clipboard/clipboard-undo-entry.md`.

const SURFACES = [
	{ name: 'a paragraph', doc: 'ab\n', path: [0], end: 2, typed: 'abxy\n' },
	{ name: 'a code block', doc: '```\nab\n```\n', path: [0], end: 6, typed: '```\nabxy\n```\n' },
	{
		name: 'a table cell',
		doc: '| h |\n| --- |\n| ab |\n',
		path: [0, 1, 0],
		end: 2,
		typed: '| h |\n| --- |\n| abxy |\n'
	}
];

test.describe('a cut or paste is its own undo entry', () => {
	let editor: EditorPage;
	const source = () => editor.bridge.getSource();

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('PASTE');
	});

	/** Loads `doc` with the caret at `offset` of `path`; the held typing pause keeps a burst open
	 *  until something ends it. */
	async function openAt(doc: string, path: number[], offset: number): Promise<void> {
		await editor.loadContent(doc);
		await editor.focusBlockAtPath(path, offset);
	}

	async function typeXy(typed: string): Promise<void> {
		await editor.typeSlowly('xy');
		await expect.poll(source).toBe(typed);
	}

	for (const surface of SURFACES) {
		test(`Ctrl+V right after typing in ${surface.name} undoes alone`, async () => {
			await openAt(surface.doc, surface.path, surface.end);
			await typeXy(surface.typed);
			await editor.paste();
			await expect.poll(source).toContain('PASTE');

			await editor.undo();
			await expect.poll(source).toBe(surface.typed);
		});

		test(`typing right after Ctrl+V in ${surface.name} undoes and redoes apart from it`, async () => {
			await openAt(surface.doc, surface.path, surface.end);
			await editor.paste();
			await expect.poll(source).toContain('PASTE');
			const pasted = await source();
			await editor.typeSlowly('z');
			await expect.poll(source).toContain('PASTEz');
			const typed = await source();

			await editor.undo();
			await expect.poll(source).toBe(pasted);
			await editor.undo();
			await expect.poll(source).toBe(surface.doc);
			await editor.redo();
			await expect.poll(source).toBe(pasted);
			await editor.redo();
			await expect.poll(source).toBe(typed);
		});

		test(`Ctrl+X right after typing in ${surface.name} undoes alone`, async ({ page }) => {
			await openAt(surface.doc, surface.path, surface.end);
			await typeXy(surface.typed);
			await page.keyboard.press('Shift+ArrowLeft');
			await page.keyboard.press('ControlOrMeta+x');
			await expect.poll(source).not.toContain('xy');

			await editor.undo();
			await expect.poll(source).toBe(surface.typed);
		});

		test(`typing right after Ctrl+X in ${surface.name} undoes apart from it`, async ({ page }) => {
			await openAt(surface.doc, surface.path, surface.end);
			await page.keyboard.press('Shift+ArrowLeft');
			await page.keyboard.press('ControlOrMeta+x');
			await expect.poll(source).not.toBe(surface.doc);
			const cut = await source();
			await editor.typeSlowly('z');
			await expect.poll(source).not.toBe(cut);

			await editor.undo();
			await expect.poll(source).toBe(cut);
			await editor.undo();
			await expect.poll(source).toBe(surface.doc);
		});
	}

	// The menus reach the same paste step through `insertMarkdown`, the cell menu through its own.
	for (const surface of [SURFACES[0], SURFACES[2]]) {
		test(`a menu Paste right after typing in ${surface.name} undoes alone`, async ({ page }) => {
			await openAt(surface.doc, surface.path, surface.end);
			await typeXy(surface.typed);
			const at = await textRunCenter(page, 'abxy');
			await page.mouse.click(at.x, at.y, { button: 'right' });
			const paste = page.locator('.md-menu').getByRole('menuitem', { name: 'Paste', exact: true });
			await expect(paste).toBeVisible();
			await paste.click();
			await expect.poll(source).toContain('PASTE');

			await editor.undo();
			await expect.poll(source).toBe(surface.typed);
		});
	}

	// The routes that never reach a block's own paste: each commits as a structural edit.
	const PROSE = 'ab\n\ncd\n';
	const STRUCTURAL = [
		{
			name: 'a paste over a range across blocks',
			doc: PROSE,
			path: [0],
			cut: false,
			clip: 'PASTE'
		},
		{ name: 'a cut across blocks', doc: PROSE, path: [0], cut: true, clip: 'PASTE' },
		{
			name: 'a grid pasted into a cell',
			doc: '| h | i |\n| --- | --- |\n| ab | c |\n',
			path: [0, 1, 0],
			cut: false,
			clip: '1\t2\n3\t4'
		}
	];
	for (const route of STRUCTURAL) {
		test(`${route.name} undoes apart from the typing either side`, async ({ page }) => {
			await editor.seedClipboard(route.clip);
			await openAt(route.doc, route.path, 2);
			const typed = route.doc.replace('ab', 'abxy');
			await typeXy(typed);
			if (route.doc === PROSE) {
				await page.keyboard.press('Shift+ArrowRight');
				await page.keyboard.press('Shift+ArrowRight');
				await expect.poll(() => editor.bridge.isCrossBlockSelection()).toBe(true);
			}
			if (route.cut) await page.keyboard.press('ControlOrMeta+x');
			else await editor.paste();
			await expect.poll(source).not.toBe(typed);
			const landed = await source();
			await editor.typeSlowly('z');
			await expect.poll(source).not.toBe(landed);

			await editor.undo();
			await expect.poll(source).toBe(landed);
			await editor.undo();
			await expect.poll(source).toBe(typed);
		});
	}
});

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import type { PresentationMode } from '../../../presentation-mode';
import { PluginsPage } from './helpers';
import { edgeKey } from '../../platform-keys';
import { pointAtRaw } from '../../text-runs';
import { dragSelection } from '../../selection-drag';
import { findInput, openReplace, replaceInput } from '../search/helpers';

// Every route that writes an opener on a line above a block of its family leaves that block whole:
// the opener gets its own closing line, or reads alone already. Each row drives the route with
// real keys, clicks and drags, then reads the bytes, the last block's kind and a reload of the
// tree. Requirements: e2e/requirements/plugins/opener-write-routes.md.

interface Opener {
	opener: string;
	below: { raw: string; kind: string };
	/** The opener as the write leaves it, closing line included. */
	written: string;
	/** Where a range delete cuts the opener in two halves that open nothing. */
	cut: number;
}

const OPENERS: Opener[] = [
	{ opener: '$$', below: { raw: '$$\nx\n$$\n', kind: 'mathBlock' }, written: '$$\n$$', cut: 1 },
	{
		opener: ':::note',
		below: { raw: ':::tip\nbody\n:::\n', kind: 'admonition' },
		written: ':::note\n:::',
		cut: 3
	},
	// An HTML block ends at a blank line, so `<details>` alone never waits on the block below.
	{
		opener: '<details>',
		below: { raw: '<details>\n<summary>S</summary>\n\nbody\n\n</details>\n', kind: 'details' },
		written: '<details>',
		cut: 4
	}
];

interface Route {
	name: string;
	/** Only the openers the route can write; absent means all of them. */
	only?: string[];
	/** The document before, built around the block below. */
	doc(o: Opener): string;
	act(editor: PluginsPage, page: Page, o: Opener): Promise<void>;
	after(o: Opener): string;
}

const tail = (o: Opener) => `Next\n\n${o.below.raw}`;
/** `Top`, an empty paragraph the route writes into, `Next`, then the block below. */
const aboveBlock = (o: Opener) => `Top\n\n\n\n${tail(o)}`;
const writtenAbove = (o: Opener) => `Top\n\n${o.written}\n\n${tail(o)}`;
/** A write into `aboveBlock`'s empty paragraph keeps the extra blank line that paragraph was. */
const writtenInto = (o: Opener, written = o.written, head = 'Top') =>
	`${head}\n\n${written}\n\n\n${tail(o)}`;

const ROUTES: Route[] = [
	{
		name: 'typed one key at a time',
		doc: aboveBlock,
		act: async (editor, page, o) => {
			await editor.focusBlockEnd(1);
			await page.keyboard.type(o.opener);
		},
		// The completer answers a typed `$$` with an empty body line for the caret.
		after: (o) => writtenInto(o, o.opener === '$$' ? '$$\n\n$$' : o.written)
	},
	{
		name: 'finished by a `$` the auto-pair declines',
		only: ['$$'],
		doc: aboveBlock,
		act: async (editor, page) => {
			await editor.focusBlockEnd(1);
			await page.keyboard.type('$');
			await page.keyboard.press(edgeKey('lineStart'));
			await page.keyboard.type('$');
		},
		after: (o) => writtenInto(o)
	},
	{
		name: 'pasted into a line',
		doc: aboveBlock,
		act: async (editor, _page, o) => {
			await editor.focusBlockEnd(1);
			await editor.seedClipboard(o.opener);
			await editor.paste();
		},
		after: (o) => writtenInto(o)
	},
	{
		name: 'pasted as the first of two blocks',
		doc: aboveBlock,
		act: async (editor, _page, o) => {
			await editor.focusBlockEnd(1);
			await editor.seedClipboard(`${o.opener}\n\nfoo`);
			await editor.paste();
		},
		after: (o) => writtenInto(o, `${o.written}\n\nfoo`)
	},
	{
		name: 'dropped onto an empty line',
		doc: (o) => `from ${o.opener}\n\n\n\n${tail(o)}`,
		act: async (editor, page, o) => {
			await editor.focusBlockEnd(0);
			for (let i = 0; i < o.opener.length; i++) await page.keyboard.press('Shift+ArrowLeft');
			const from = await pointAtRaw(page, [0], 5 + Math.floor(o.opener.length / 2));
			// The empty line has no glyph to aim at, so the drop aims just inside its start.
			const line = await editor.getBlock(1).boundingBox();
			if (!line) throw new Error('the empty line has no box');
			await dragSelection(page, from, { x: line.x + 2, y: line.y + line.height / 2 });
		},
		after: (o) => writtenInto(o, o.written, 'from ')
	},
	{
		name: 'pasted over a range of two blocks',
		doc: (o) => `Top\n\naa\n\nbb\n\n${tail(o)}`,
		act: async (editor, _page, o) => {
			await editor.focusBlockStart(1);
			await editor.shiftClickBlock([2], 2);
			await editor.seedClipboard(o.opener);
			await editor.paste();
		},
		after: writtenAbove
	},
	{
		name: 'joined by a range delete',
		doc: (o) =>
			`Top\n\n${o.opener.slice(0, o.cut)}!\n\nmid\n\nz${o.opener.slice(o.cut)}\n\n${tail(o)}`,
		act: async (editor, page, o) => {
			await editor.focusBlock(1, o.cut);
			await editor.shiftClickBlock([3], 1);
			await page.keyboard.press('Backspace');
		},
		after: writtenAbove
	},
	{
		name: 'split off by Enter',
		doc: (o) => `Top\n\nx${o.opener}\n\n${tail(o)}`,
		act: async (editor, page) => {
			await editor.focusBlock(1, 1);
			await page.keyboard.press('Enter');
		},
		after: (o) => `Top\n\nx\n\n${o.written}\n\n${tail(o)}`
	},
	{
		name: 'written by find and replace',
		doc: (o) => `Top\n\nQQ\n\n${tail(o)}`,
		act: async (editor, page, o) => {
			await openReplace(editor);
			await findInput(page).click();
			await page.keyboard.type('QQ');
			await replaceInput(page).fill(o.opener);
			await page.getByRole('button', { name: 'All', exact: true }).click();
		},
		after: writtenAbove
	},
	{
		name: 'written by Replace with clipboard',
		doc: (o) => `Top\n\n\`\`\`\ncode\n\`\`\`\n\n${tail(o)}`,
		act: async (editor, page, o) => {
			await editor.seedClipboard(o.opener);
			await page.locator('[data-block-kind="fencedCode"]').first().click({ button: 'right' });
			const menu = page.getByRole('menu', { name: 'Block actions' });
			await menu.getByRole('menuitem', { name: 'Replace with clipboard' }).click();
		},
		after: writtenAbove
	},
	{
		name: 'moved above it with Alt+ArrowUp',
		doc: (o) => `Top\n\n${tail(o)}\n${o.opener}\n`,
		act: async (editor, page) => {
			await editor.focusBlockEnd(3);
			await page.keyboard.press('Alt+ArrowUp');
		},
		after: (o) => `Top\n\nNext\n\n${o.written}\n\n${o.below.raw}`
	}
];

const MODES: PresentationMode[] = ['source', 'live'];

for (const mode of MODES) {
	test.describe(`an opener written above a block of its family, ${mode} mode`, () => {
		let editor: PluginsPage;

		test.beforeEach(async ({ page }) => {
			editor = new PluginsPage(page);
			await editor.gotoPlugins('math');
			await editor.setPresentationMode(mode);
		});

		for (const route of ROUTES) {
			for (const o of OPENERS.filter((o) => !route.only || route.only.includes(o.opener))) {
				test(`\`${o.opener}\` ${route.name} leaves the ${o.below.kind} below whole`, async ({
					page
				}) => {
					await editor.loadContent(route.doc(o));
					await route.act(editor, page, o);

					await expect.poll(() => editor.bridge.getSource()).toBe(route.after(o));
					const count = await editor.bridge.getBlockCount();
					expect(await editor.bridge.getBlockKind(count - 1)).toBe(o.below.kind);
					expect(await editor.parseConverged()).toBe(true);
				});
			}
		}
	});
}

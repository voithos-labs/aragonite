// A paste spends what the caret memory holds at the caret as a typed letter does: a held space, a
// pending bold, a typed closer, a chip stop on either side of a code span's edge, a click past the
// line's end. One line, a line with its line ending and two paragraphs each take it, and a letter
// typed next follows the paste.
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';

interface Spot {
	name: string;
	line: string;
	place(page: Page, editor: EditorPage, raw: string): Promise<void>;
	/** The bytes after the paste of each clipboard, then after a typed `Z`. */
	want: Record<'one' | 'one⏎' | 'one, two', [string, string]>;
}

const at = (raw: string, needle: string, delta = 0) => raw.indexOf(needle) + delta;

const SPOTS: Spot[] = [
	{
		name: 'a held space after a run',
		line: 'a **bc**',
		async place(page, editor, raw) {
			await editor.focusBlockAtPath([0], at(raw, 'a '));
			await page.keyboard.press(edgeKey('lineEnd'));
			await page.keyboard.type(' ');
		},
		want: {
			one: ['a **bc one**\n\nAfter\n', 'a **bc oneZ**\n\nAfter\n'],
			'one⏎': ['a **bc one**\n\n\nAfter\n', 'a **bc one**\n\nZ\n\nAfter\n'],
			'one, two': ['a **bc one**\n\n**two**\n\nAfter\n', 'a **bc one**\n\n**twoZ**\n\nAfter\n']
		}
	},
	{
		name: 'a pending bold',
		line: 'alpha',
		async place(page, editor) {
			await editor.focusBlockAtPath([0], 0);
			await page.keyboard.press(edgeKey('lineEnd'));
			await page.keyboard.press('ControlOrMeta+b');
		},
		want: {
			one: ['alpha**one**\n\nAfter\n', 'alpha**oneZ**\n\nAfter\n'],
			'one⏎': ['alpha**one**\n\n\nAfter\n', 'alpha**one**\n\nZ\n\nAfter\n'],
			'one, two': ['alpha**one**\n\n**two**\n\nAfter\n', 'alpha**one**\n\n**twoZ**\n\nAfter\n']
		}
	},
	{
		name: 'a typed closer',
		line: 'a **bc** d',
		async place(page, editor, raw) {
			await editor.focusBlockAtPath([0], at(raw, 'c**', 1));
			await page.keyboard.type('**');
		},
		want: {
			one: ['a **bc**one d\n\nAfter\n', 'a **bc**oneZ d\n\nAfter\n'],
			'one⏎': ['a **bc**one\n d\n\nAfter\n', 'a **bc**one\nZ d\n\nAfter\n'],
			'one, two': ['a **bc**one\n\ntwo d\n\nAfter\n', 'a **bc**one\n\ntwoZ d\n\nAfter\n']
		}
	},
	{
		name: 'a chip stop past a code span',
		line: 'a `bc` d',
		async place(page, editor, raw) {
			await editor.focusBlockAtPath([0], at(raw, 'c`', 1));
			await page.keyboard.press('ArrowRight');
		},
		want: {
			one: ['a `bc`one d\n\nAfter\n', 'a `bc`oneZ d\n\nAfter\n'],
			'one⏎': ['a `bc`one\n d\n\nAfter\n', 'a `bc`one\nZ d\n\nAfter\n'],
			'one, two': ['a `bc`one\n\ntwo d\n\nAfter\n', 'a `bc`one\n\ntwoZ d\n\nAfter\n']
		}
	},
	{
		name: 'a chip stop inside a code span',
		line: 'a `bc` d',
		async place(page, editor, raw) {
			await editor.focusBlockAtPath([0], at(raw, 'c`', 1));
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowLeft');
		},
		want: {
			one: ['a `bcone` d\n\nAfter\n', 'a `bconeZ` d\n\nAfter\n'],
			'one⏎': ['a `bcone`\n d\n\nAfter\n', 'a `bcone`\nZ d\n\nAfter\n'],
			'one, two': ['a `bcone`\n\n`two` d\n\nAfter\n', 'a `bcone`\n\n`twoZ` d\n\nAfter\n']
		}
	},
	{
		name: 'a click past the line’s end',
		line: 'a **bc**',
		async place(page, editor, raw) {
			const p = await page.evaluate(([o]) => (window as any).__test.pointAtRaw([0], o, 'before'), [
				at(raw, 'c**', 1)
			] as const);
			await page.mouse.click(p.x + 30, p.y);
			await editor.waitForRenderFlush();
		},
		want: {
			one: ['a **bc**one\n\nAfter\n', 'a **bc**oneZ\n\nAfter\n'],
			'one⏎': ['a **bc**one\n\n\nAfter\n', 'a **bc**one\n\nZ\n\nAfter\n'],
			'one, two': ['a **bc**one\n\ntwo\n\nAfter\n', 'a **bc**one\n\ntwoZ\n\nAfter\n']
		}
	}
];

const CLIPS = { one: 'one', 'one⏎': 'one\n', 'one, two': 'one\n\ntwo' } as const;

test.describe('a paste spends the caret memory as a typed letter does (live)', () => {
	for (const spot of SPOTS)
		for (const [name, clip] of Object.entries(CLIPS) as [keyof typeof CLIPS, string][])
			test(`${spot.name}: ${name}`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode('live');
				const source = `${spot.line}\n\nAfter\n`;
				await editor.loadContent(source);
				await spot.place(page, editor, spot.line);
				await editor.waitForRenderFlush();
				const placed = await editor.bridge.getSource();
				await editor.seedClipboard(clip);
				await editor.paste();
				const [pasted, typed] = spot.want[name];
				await editor.bridge.waitForSource((s) => s !== placed);
				await expect.poll(() => editor.bridge.getSource()).toBe(pasted);
				await page.keyboard.type('Z');
				await expect.poll(() => editor.bridge.getSource()).toBe(typed);
			});
});

import { test, expect } from '../../fixtures';
import type { PresentationMode } from '../../../presentation-mode';
import { PluginsPage } from './helpers';
import { edgeKey } from '../../platform-keys';

// An opener typed into an empty paragraph above a finished block of its family leaves that block
// whole: the opener closes itself, or isn't written. Every gesture is real keys, read off the bytes,
// the block kinds and a reload of the tree. Requirements:
// e2e/requirements/plugins/typed-opener-above-block.md.

const BELOW = {
	'a math block': { raw: '$$\nx\n$$\n', kind: 'mathBlock' },
	'a directive block': { raw: ':::tip\nbody\n:::\n', kind: 'admonition' }
} as const;

const MODES: PresentationMode[] = ['source', 'live'];

for (const mode of MODES) {
	test.describe(`an opener typed above a finished block, ${mode} mode`, () => {
		let editor: PluginsPage;

		test.beforeEach(async ({ page }) => {
			editor = new PluginsPage(page);
			await editor.gotoPlugins('math');
			await editor.setPresentationMode(mode);
		});

		/** `Top`, an empty paragraph with the caret in it, `Next`, then the block below. */
		async function aboveBlock(below: string): Promise<void> {
			await editor.loadContent(`Top\n\n\n\nNext\n\n${below}`);
			await editor.focusBlockEnd(1);
		}

		async function expectBelowWhole(below: { raw: string; kind: string }): Promise<void> {
			const tail = `Next\n\n${below.raw}`;
			await expect.poll(async () => (await editor.bridge.getSource()).endsWith(tail)).toBe(true);
			const count = await editor.bridge.getBlockCount();
			expect(await editor.bridge.getBlockKind(count - 1)).toBe(below.kind);
			expect(await editor.parseConverged()).toBe(true);
		}

		for (const [name, below] of Object.entries(BELOW)) {
			test(`a lone \`$\` above ${name} types alone`, async ({ page }) => {
				await aboveBlock(below.raw);
				await page.keyboard.type('$');
				await page.keyboard.type('y');

				await editor.bridge.waitForSourceContains('Top\n\n$y\n');
				await expectBelowWhole(below);
			});

			test(`\`$x$\` above ${name} is inline math, the caret after it`, async ({ page }) => {
				await aboveBlock(below.raw);
				await page.keyboard.type('$x$');
				await page.keyboard.type(' z');

				await editor.bridge.waitForSourceContains('Top\n\n$x$ z\n');
				await expectBelowWhole(below);
			});

			test(`\`$$\` above ${name} is a math block of its own, the caret in its body`, async ({
				page
			}) => {
				await aboveBlock(below.raw);
				await page.keyboard.type('$$');
				await editor.bridge.waitForSourceContains('Top\n\n$$\n\n$$\n');
				await page.keyboard.type('y');
				await editor.getBlock(0).click();

				await editor.bridge.waitForSourceContains('Top\n\n$$\ny\n$$\n');
				await expectBelowWhole(below);
			});
		}

		// The completer only answers a line typed at its end, so these reach the closer of its own.
		test('a pasted `$$` above a math block gets a closer of its own', async () => {
			await aboveBlock(BELOW['a math block'].raw);
			await editor.seedClipboard('$$');
			await editor.paste();

			await editor.bridge.waitForSourceContains('Top\n\n$$\n$$\n');
			await expectBelowWhole(BELOW['a math block']);
		});

		test('`$$` finished in front of the caret gets a closer of its own', async ({ page }) => {
			await aboveBlock(BELOW['a math block'].raw);
			await page.keyboard.type('$');
			await page.keyboard.press(edgeKey('lineStart'));
			await page.keyboard.type('$');

			await editor.bridge.waitForSourceContains('Top\n\n$$\n$$\n');
			await expectBelowWhole(BELOW['a math block']);
		});

		// Nothing below could close it, so a reload reads it as a paragraph too.
		test('`:::note` typed above a math block stays a paragraph', async ({ page }) => {
			await aboveBlock(BELOW['a math block'].raw);
			await page.keyboard.type(':::note');

			await editor.bridge.waitForSourceContains('Top\n\n:::note\n\n');
			await expectBelowWhole(BELOW['a math block']);
		});

		test('`:::note` typed above a directive block closes as it is typed', async ({ page }) => {
			test.fixme(
				true,
				'#801: a directive opener line holds no caret, so it reads the blocks below in as it is typed'
			);
			await aboveBlock(BELOW['a directive block'].raw);
			await page.keyboard.type(':::note');

			await editor.bridge.waitForSourceContains('Top\n\n:::note\n:::\n');
			await expectBelowWhole(BELOW['a directive block']);
		});

		test('one undo after `$$` goes back to the `$` before the keystroke', async ({ page }) => {
			await aboveBlock(BELOW['a math block'].raw);
			await page.keyboard.type('$$');
			await editor.bridge.waitForSourceContains('Top\n\n$$\n\n$$\n');
			await editor.getBlock(0).click();
			await editor.waitForRenderFlush();

			await editor.undo();
			await editor.bridge.waitForSourceContains('Top\n\n$\n');
			await page.keyboard.type('q');
			await editor.bridge.waitForSourceContains('Top\n\n$q\n');
			await expectBelowWhole(BELOW['a math block']);
		});

		// A container's body below reads the same way, so a `$` in a list item or a quote types alone.
		for (const [where, source, path] of [
			['a list item', '- a\n- \n\nNext\n\n$$\nx\n$$\n', [0, 1, 0]],
			['a quote', '> a\n>\n> \n\nNext\n\n$$\nx\n$$\n', [0, 1]]
		] as const) {
			test(`a lone \`$\` in ${where} above a math block types alone`, async ({ page }) => {
				await editor.loadContent(source);
				await editor.focusBlockAtPath([...path], 0);
				await page.keyboard.type('$');
				await page.keyboard.type('y');

				await editor.bridge.waitForSourceContains('$y\n\nNext\n');
				await expectBelowWhole(BELOW['a math block']);
			});
		}
	});
}

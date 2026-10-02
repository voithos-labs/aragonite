import { test, expect } from '../../../fixtures';
import { PluginsPage } from '../../plugins/helpers';

// Finishing an alert marker inside a quote that already holds text turns the quote into an alert,
// and the next key lands where the user was typing: at the start of the alert's body.

const SHAPES = [
	{
		where: 'a quote',
		seed: '> [!TI\n> body\n',
		leaf: [0, 0],
		expected: '> [!TIP]\n> xbody\n'
	},
	{
		where: 'a quote inside a list item',
		seed: '- > [!TI\n  > body\n',
		leaf: [0, 0, 0, 0],
		expected: '- > [!TIP]\n  > xbody\n'
	}
];

test.describe('blockquote: the key after a typed alert marker', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const { where, seed, leaf, expected } of SHAPES) {
			test(`finishing \`[!TIP]\` in ${where}, then \`x\`, puts \`x\` first in the body (${mode})`, async ({
				page
			}) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins('admonitions');
				await editor.setPresentationMode(mode);
				await editor.loadContent(seed);
				await editor.focusBlockAtPath(leaf, '[!TI'.length);
				await page.keyboard.type('P]');
				await expect.poll(() => editor.bridge.getSource()).toBe(seed.replace('[!TI', '[!TIP]'));
				await page.keyboard.type('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(expected);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
	}
});

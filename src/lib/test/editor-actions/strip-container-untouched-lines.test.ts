// A keystroke inside a line-prefixed container rewrites its own line and keeps every other line's
// bytes, however the author spelled the prefix: a quote, a list item, a GitHub alert, a footnote.
// Miss-analysis: the alert and footnote rebuild rows edited canonically spelled bodies, where a
// whole-body respell writes the same bytes, so the respell of untouched lines never showed.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { serialize } from '#lib/core/serializer.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { makeNestedHarness } from '#lib/test/harness/editor-actions.js';

beforeEach(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

describe('a keystroke in a line-prefixed container keeps the lines it did not touch', () => {
	it.each([
		{ kind: 'blockquote', source: '>a\n>b\n', typed: '>ax\n>b\n' },
		{ kind: 'githubAlert', source: '> [!NOTE]\n>a\n>b\n', typed: '> [!NOTE]\n>ax\n>b\n' },
		{
			kind: 'githubAlert, its blank first line',
			source: '> [!TIP]\n>  \n>a\n',
			typed: '> [!TIP]\n>  \n>ax\n'
		},
		{
			kind: 'footnoteDefinition',
			source: '[^1]:a\n     b\n\n     c\n',
			typed: '[^1]:ax\n     b\n\n     c\n'
		}
	])('$kind', async ({ source, typed }) => {
		const h = makeNestedHarness(source, { index: 0 });
		const leaf = h.getNode().children![0];
		const text = leaf.raw.replace(/\n$/, '');
		const at = text.indexOf('a') + 1;

		await h.bundle.blockEdit.updateBlockContent(
			0,
			text.slice(0, at) + 'x' + text.slice(at) + '\n',
			'authored',
			'join-typing',
			at,
			at + 1
		);

		expect(serialize(h.deps.doc)).toBe(typed);
	});
});

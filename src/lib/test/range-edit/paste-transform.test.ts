// @vitest-environment jsdom
// Where the core hands the clipboard to the host's paste transforms: once, on the raw clipboard read
// as blocks, wherever the paste lands as blocks, and nowhere it lands as text or carries the
// editor's own entry. A stub transform that turns a GitHub alert into a `:::note` stands for them.
// Miss-analysis: the transforms ran in each editor route before the core, so they also ran where
// the core lands text (a code body), and no core test could see a route that skipped them.

import { describe, expect, it } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import type { PasteHost } from '#lib/range-edit/host.js';
import { checkHost } from './test-host';

const ALERT = '> [!NOTE]\n> body\n';
const NOTE = ':::note\nbody\n:::\n';

/** The host with the stub transform, and the block kinds of each clipboard it was handed. */
function stubHost(): { host: PasteHost; seen: string[][] } {
	const seen: string[][] = [];
	const host: PasteHost = {
		...checkHost(),
		transformPaste(text, blocks) {
			seen.push(blocks.children.map((block) => block.kind));
			return text === ALERT ? NOTE : text;
		}
	};
	return { host, seen };
}

const at = (marked: string) => ({ from: marked.indexOf('‸'), to: marked.indexOf('‸') });
const paste = (more: Partial<Extract<Gesture, { paste: string }>> = {}): Gesture => ({
	paste: ALERT,
	plain: false,
	holds: 'text',
	...more
});

const LANDS_AS_BLOCKS: [name: string, marked: string, gesture: Gesture, want: string][] = [
	['in a paragraph’s text', 'ab‸cd\n', paste(), 'ab\n\n:::note\nbody\n:::\ncd\n'],
	['in an empty paragraph', 'a\n\n‸\n\nb\n', paste(), 'a\n\n:::note\nbody\n:::\n\nb\n'],
	[
		'between two blocks',
		'a\n\n‸```\nx\n```\n',
		paste({ holds: 'boundary' }),
		'a\n\n:::note\nbody\n:::\n```\nx\n```\n'
	],
	['where a block starts', '‸# h\n', paste(), ':::note\nbody\n:::\n# h\n'],
	[
		'on an empty line no block holds',
		'a\n‸\n    code\n',
		paste(),
		'a\n:::note\nbody\n:::\n\n    code\n'
	]
];

const LANDS_AS_TEXT: [name: string, marked: string, gesture: Gesture][] = [
	['in a code body', '```\nco‸de\n```\n', paste()],
	['in a container’s title', ':::note ‸\nx\n:::\n', paste()],
	['in a table cell', '| a‸ |\n| - |\n', paste()],
	['as plain text', 'ab‸cd\n', paste({ plain: true })],
	['one line after text', 'ab‸cd\n', paste({ paste: '> [!NOTE]' })],
	['among a table’s rows', '| a |\n| - |\n‸| b |\n', paste({ holds: 'boundary' })],
	['at a table row’s first byte', '| a |\n| - |\n‸| b |\n', paste()]
];

describe('the paste transforms, called by the core', () => {
	it.each(LANDS_AS_BLOCKS)('run once %s', (_name, marked, gesture, want) => {
		const { host, seen } = stubHost();
		const source = marked.replace('‸', '');
		const got = editRange(source, at(marked), gesture, 'source', host);
		expect(seen).toHaveLength(1);
		expect(got.source).toBe(want);
	});

	it('are handed the raw clipboard’s blocks', () => {
		const { host, seen } = stubHost();
		editRange('ab\n', { from: 2, to: 2 }, paste({ paste: '# h\npara\n' }), 'source', host);
		expect(seen).toEqual([['heading', 'paragraph']]);
	});

	it.each(LANDS_AS_TEXT)('run nowhere %s', (_name, marked, gesture) => {
		const { host, seen } = stubHost();
		const source = marked.replace('‸', '');
		const got = editRange(source, at(marked), gesture, 'source', host);
		expect(seen).toEqual([]);
		expect(got.source).not.toContain(':::note\nbody');
	});

	it('run for no paste that carries the editor’s own entry, matched or not', () => {
		const { host, seen } = stubHost();
		const source = 'ab\n\n> [!NOTE]\n> body\n\ncd\n';
		const cut = editRange(source, { from: 4, to: 20 }, 'cut', 'source', host);
		const own = paste({ paste: cut.clipboard!, own: cut.own, holds: cut.caret.holds });
		const back = editRange(cut.source, at2(cut.caret.at), own, 'source', host);
		expect(back.source).toBe(source);
		const elsewhere = editRange(cut.source, at2(1), own, 'source', host);
		expect(elsewhere.source).toContain('[!NOTE]');
		expect(seen).toEqual([]);
	});

	it('run over a range as at a caret, and never for a drop', () => {
		const { host, seen } = stubHost();
		const over = editRange('ab\n\ncd\n', { from: 1, to: 5 }, paste(), 'source', host);
		expect(over.source).toContain(':::note\nbody\n:::');
		expect(seen).toHaveLength(1);
		editRange(ALERT + '\nab\n', { from: 0, to: 17 }, { drop: 21, copy: true }, 'source', host);
		expect(seen).toHaveLength(1);
	});
});

const at2 = (byte: number) => ({ from: byte, to: byte });

// @vitest-environment jsdom
// The emoji corpus read by an editor running the plugin, row by row: which bytes are a glyph, what
// the drawing shows, and what a reader reads. The rows hold whatever shape the package takes.
// Miss-analysis: the recognizer rows read the scan's nodes alone, so none held what an editor
// running the plugin draws and reads for the same bytes.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EMOJI_KIND, emojiPlugin } from '#packages/emoji/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { Block, Piece } from '#lib/plugin.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const PLUGIN = emojiPlugin();
const KIND: string = EMOJI_KIND;

// Iterative, as an author's walk over a block's pieces would be.
function glyphSpans(pieces: readonly Piece[]): [number, number][] {
	const out: [number, number][] = [];
	const stack = [...pieces].reverse();
	while (stack.length > 0) {
		const piece = stack.pop()!;
		if (piece.kind === KIND) out.push([piece.from, piece.to]);
		for (let i = piece.children.length - 1; i >= 0; i--) stack.push(piece.children[i]);
	}
	return out;
}

const leaves = (blocks: readonly Block[]) =>
	blocks.flatMap((block) => [...block.walk()]).filter((block) => block.children.length === 0);

// Source, the glyphs' document bytes, the glyphs drawn, and the blocks' textContent.
type Row = [source: string, spans: [number, number][], drawn: string[], reads: string];
const ROWS: Row[] = [
	[':smile:', [[0, 7]], ['😄'], '😄'],
	['ship it :rocket: now', [[8, 16]], ['🚀'], 'ship it 🚀 now'],
	[':name[label]', [], [], ':name[label]'],
	[':name{.cls}', [], [], ':name{.cls}'],
	['meet at 10:30', [], [], 'meet at 10:30'],
	['see https://x.dev', [], [], 'see https://x.dev'],
	[':notaname:', [], [], ':notaname:'],
	[
		':+1: and :-1:',
		[
			[0, 4],
			[9, 13]
		],
		['👍', '👎'],
		'👍 and 👎'
	],
	[':Smile:', [], [], ':Smile:'],
	[
		'a :smile::rocket: b',
		[
			[2, 9],
			[9, 17]
		],
		['😄', '🚀'],
		'a 😄🚀 b'
	],
	['*:smile:*', [[1, 8]], ['😄'], '😄'],
	['`:smile:`', [], [], ':smile:'],
	[':smile', [], [], ':smile'],
	['x:smile:y', [[1, 8]], ['😄'], 'x😄y'],
	[
		':smile:\n:rocket:',
		[
			[0, 7],
			[8, 16]
		],
		['😄', '🚀'],
		'😄\n🚀'
	],
	['# Mood :smile: today', [[7, 14]], ['😄'], 'Mood 😄 today'],
	['> quoted :tada:', [[9, 15]], ['🎉'], 'quoted 🎉'],
	[
		'| :smile: | b |\n| - | - |\n| c | :rocket: |',
		[
			[2, 9],
			[32, 40]
		],
		['😄', '🚀'],
		'😄\tb\nc\t🚀'
	]
];

describe('the emoji corpus, read by an editor running the plugin', () => {
	it.each(ROWS)('%j', async (source, spans, drawn, reads) => {
		const m = mountEditor({ source: `${source}\n`, plugins: [PLUGIN] });
		await m.settle();
		const blocks = m.instance.doc.blocks;
		expect(leaves(blocks).flatMap((block) => glyphSpans(block.pieces))).toEqual(spans);
		const glyphs = [...m.target.querySelectorAll('.md-emoji-widget')].map((el) => el.textContent);
		expect(glyphs).toEqual(drawn);
		expect(blocks.map((block) => block.textContent).join('\n')).toBe(reads);
	});
});

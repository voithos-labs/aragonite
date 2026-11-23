import { describe, expect, it } from 'vitest';
import { grammar, type Piece } from '#lib/plugin.js';
import { emoji } from '#packages/emoji/src/index.js';

const EMOJI = 'emoji/emoji';

const piecesIn = (source: string, plugins = [emoji]): readonly Piece[] =>
	grammar(plugins).parse(`${source}\n`).blocks[0].pieces;
const glyphsIn = (source: string) => piecesIn(source).filter((piece) => piece.kind === EMOJI);
const shapeOf = (pieces: readonly Piece[]) =>
	pieces.map(({ kind, from, to }) => ({ kind, from, to }));

// Where no editor lists emoji, `:smile:` is ordinary prose: a document authored with shortcodes
// opens byte-identically in an editor without the plugin.
describe('an emoji shortcode is dormant where emoji is not listed', () => {
	it('leaves :smile: to literal text, after another grammar listed emoji', () => {
		expect(glyphsIn('a :smile: b')).toHaveLength(1);
		expect(piecesIn('a :smile: b', []).map((piece) => piece.kind)).toEqual(['text']);
	});
});

describe('the shortcode reading', () => {
	const claims: Array<[string, string, string]> = [
		['a plain shortcode', ':smile:', '😄'],
		['a `+`-bearing shortcode', ':+1:', '👍'],
		['an alias form', ':thumbsup:', '👍'],
		['an underscore shortcode', ':heart_eyes:', '😍']
	];
	it.each(claims)('claims %s (%s) carrying its glyph', (_name, source, glyph) => {
		expect(glyphsIn(source)).toMatchObject([{ from: 0, to: source.length, data: glyph }]);
	});

	const declines: Array<[string, string]> = [
		['an unknown name', ':notaname:'],
		['whitespace after the colon', ': smile:'],
		['an unterminated shortcode', ':smile'],
		['an empty pair', '::']
	];
	it.each(declines)('declines %s (%j) as an editor without emoji reads it', (_name, source) => {
		expect(shapeOf(piecesIn(source))).toEqual(shapeOf(piecesIn(source, [])));
		expect(glyphsIn(source)).toHaveLength(0);
	});

	// The claim closes at its own `:`; the bytes after it read as ordinary inline content.
	it('claims only through the closing colon, leaving a trailing colon literal', () => {
		const pieces = piecesIn(':smile::');
		expect(pieces[0]).toMatchObject({ kind: EMOJI, from: 0, to: 7 });
		expect(pieces.at(-1)).toMatchObject({ kind: 'text', text: ':' });
	});
});

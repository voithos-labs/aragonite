// Emoji and the directive text level both read at `:`, each in its own reading: emoji only in a
// grammar that lists it, directive text wherever directives are on.
import { beforeEach, describe, expect, it } from 'vitest';
import { activateDirectives, grammar, type Piece } from '#lib/plugin.js';
import { DIRECTIVE_TEXT } from '#lib/core/directive/kinds.js';
import { emoji } from '#packages/emoji/src/index.js';

const EMOJI = 'emoji/emoji';

const piecesOf = (source: string): readonly Piece[] =>
	grammar([emoji]).parse(`${source}\n`).blocks[0].pieces;
const kindsIn = (source: string) => piecesOf(source).map((piece) => piece.kind);

describe('emoji and the directive text level coexist on `:`', () => {
	beforeEach(() => activateDirectives());

	it('a bare :smile: is an emoji; the directive inline syntax handler declined it', () => {
		const glyph = piecesOf(':smile:').find((piece) => piece.kind === EMOJI);
		expect(glyph).toMatchObject({ from: 0, to: 7, data: '😄' });
	});

	it(':name[label]{.cls} stays a directive; emoji never sees a closing colon', () => {
		expect(kindsIn(':name[label]{.cls}')[0]).toBe(DIRECTIVE_TEXT);
		expect(kindsIn(':name[label]{.cls}')).not.toContain(EMOJI);
	});

	it('a bare :name is literal; neither inline syntax handler claims it', () => {
		expect(kindsIn(':name')).toEqual(['text']);
	});

	it('an unknown :notaname: stays literal after both inline syntax handlers decline', () => {
		expect(kindsIn(':notaname:')).toEqual(['text']);
	});
});

// A grammar read before the activation still meets the directive level, so the order an app
// lists emoji and turns directives on in decides nothing.
describe('the directive text level reads in a grammar made before it was on', () => {
	const listed = grammar([emoji]);
	beforeEach(() => activateDirectives());

	it('recognizes :name[label] with emoji listed first', () => {
		expect(listed.parse(':name[label]\n').blocks[0].pieces[0].kind).toBe(DIRECTIVE_TEXT);
	});

	it('leaves emoji claiming its own shortcodes', () => {
		const kinds = listed.parse(':smile:\n').blocks[0].pieces.map((piece) => piece.kind);
		expect(kinds).toEqual([EMOJI]);
	});
});

// Miss-analysis: the one-character test lived as a code-unit count in the leaf, and no row typed an emoji.
import { describe, expect, it } from 'vitest';
import { isAtMostOneCharacter, wordSegments } from '#lib/core/text-units.js';

describe('isAtMostOneCharacter', () => {
	it('counts a user-perceived character, not code units', () => {
		for (const text of ['', 'a', '😀', '\u{1F468}‍\u{1F469}‍\u{1F467}', 'é', '\r\n']) {
			expect(isAtMostOneCharacter(text), JSON.stringify(text)).toBe(true);
		}
		for (const text of ['ab', '😀a', 'a\n']) {
			expect(isAtMostOneCharacter(text), JSON.stringify(text)).toBe(false);
		}
	});
});

// Miss-analysis: every word row ran on one engine's segmenter, and Firefox's and WebKit's join
// `foo.bar` where Chromium's cuts it, so the word delete took different text on each.
describe('wordSegments', () => {
	const cut = (text: string) => {
		const segments = wordSegments(text)!;
		const out: string[] = [];
		for (let at = 0; at < text.length;) {
			const segment = segments.containing(at)!;
			out.push(segment.segment + (segment.isWordLike ? '*' : ''));
			at = segment.index + segment.segment.length;
		}
		return out;
	};

	it('cuts a full stop or a colon between letters, as Chromium does', () => {
		expect(cut('foo.bar baz')).toEqual(['foo*', '.', 'bar*', ' ', 'baz*']);
		expect(cut('x.y.z')).toEqual(['x*', '.', 'y*', '.', 'z*']);
		expect(cut('a:b')).toEqual(['a*', ':', 'b*']);
		expect(cut('e.g.')).toEqual(['e*', '.', 'g*', '.']);
		expect(cut('a\uFF0Eb')).toEqual(['a*', '\uFF0E', 'b*']);
		expect(cut('a.\u0301b')).toEqual(['a*', '.\u0301', 'b*']);
	});

	it('keeps a number, an apostrophe and a middle dot inside their word', () => {
		for (const word of ['3.14', '1,000', "don't", 'x\u2019y', 'a\u00B7b', 'foo_bar']) {
			expect(cut(word), word).toEqual([`${word}*`]);
		}
	});
});

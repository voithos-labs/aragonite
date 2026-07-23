import { describe, it, expect } from 'vitest';
import { EMOJI_TABLE } from '$lib/plugins/emoji';

// The generated table's shape — pinned, never the full listing. A regen that lost
// its aliases, collapsed to nothing, or ballooned absurdly fails here; the exact
// glyph bytes for a couple of anchors guard against a mangled decode.
describe('EMOJI_TABLE — generated gemoji shortcode map', () => {
	it('maps a canonical shortcode and a `+`-bearing one to their glyphs', () => {
		expect(EMOJI_TABLE.get('smile')).toBe('😄');
		expect(EMOJI_TABLE.get('+1')).toBe('👍');
	});

	it('keys each alias separately, so an alias resolves to the same glyph', () => {
		expect(EMOJI_TABLE.get('thumbsup')).toBe('👍');
	});

	it('carries the full gemoji breadth without a runaway size', () => {
		expect(EMOJI_TABLE.size).toBeGreaterThan(1500);
		expect(EMOJI_TABLE.size).toBeLessThan(4000);
	});

	it('has no entry for a non-shortcode word', () => {
		expect(EMOJI_TABLE.has('notaname')).toBe(false);
	});
});

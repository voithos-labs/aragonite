// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { MARK_FORMATS, markersOf, whole } from './format-toggle-fixture';

// What a toggle may write where the delimiters do not paint: the bytes are a candidate until the
// render path agrees the screen still reads the same (live-mode.md § 2). Miss-analysis: every
// toggle case selected a bare word, so none ever handed the seam a slice markdown refuses to wrap
// — and the seam verified nothing, so the suite had nothing to catch it with.

const live = (raw: string, selection: { start: number; end: number }, format: InlineMarkKind) =>
	toggleInlineFormat({ display: raw, content: whole(raw), selection }, format, 'live');

const screenOf = (display: string) =>
	renderedText(parseInline(display, 0, display.length), display, CONTENT_VISIBILITY);

describe('a live toggle verifies its bytes against the screen', () => {
	// The contract every mark owes, whatever its delimiters can enclose: a toggle changes
	// formatting and never the text on screen.
	it.each(MARK_FORMATS)('leaves the screen exactly as it was (%s)', (format) => {
		const trailing = live('hello world', { start: 0, end: 6 }, format);
		expect(screenOf(trailing!.newDisplay)).toBe('hello world');
		const leading = live('hello world', { start: 5, end: 11 }, format);
		expect(screenOf(leading!.newDisplay)).toBe('hello world');
	});

	// The check is over the SCREEN, not over the delimiter count: a wrap beside a run the reader
	// already sees leaves that run exactly where it was, so the write stands.
	it('writes a wrap beside painted literal text', () => {
		expect(live('**word', { start: 2, end: 6 }, 'strong')?.newDisplay).toBe('****word**');
	});
});

// The wrap put the boundary space OUTSIDE the delimiters, so the selection that applied the mark
// still reaches past the run it made: a second press on that selection has to take the mark back.
// Miss-analysis: every boundary-space case above applies, and every unapply case in these suites
// selected the run's own bytes — so no test ever pressed twice on one selection.
describe('a toggle takes back the wrap that same selection wrote', () => {
	// The three on-screen readings of one run with its neighbouring spaces: ` b `, ` b` and `b `,
	// whose endpoints sit on the run's CONTENT here, since live paints no delimiter to select.
	it.each(MARK_FORMATS)('strips through a space on either flank (%s)', (format) => {
		const m = markersOf(format).length;
		const raw = `a ${markersOf(format)}b${markersOf(format)} c`;
		expect(live(raw, { start: 1, end: 4 + 2 * m }, format)?.newDisplay).toBe('a b c');
		expect(live(raw, { start: 1, end: 3 + m }, format)?.newDisplay).toBe('a b c');
		expect(live(raw, { start: 2 + m, end: 4 + 2 * m }, format)?.newDisplay).toBe('a b c');
	});

	// The strip re-reads the construct rather than the chord's own row, so an author's `_` survives
	// a press that would have minted `*`.
	it('keeps the run selected and the author’s delimiters unwritten', () => {
		const stripped = live('pre _mid_ post', { start: 3, end: 8 }, 'emphasis');
		expect(stripped?.newDisplay).toBe('pre mid post');
		expect(stripped?.newDisplay.slice(stripped.newSelStart, stripped.newSelEnd)).toBe('mid');
	});
});

// The preview rungs hide markers everywhere EXCEPT the block the caret is in, and a toggle only
// ever writes into the block the caret is in — so the delimiters this seam mints DO paint there,
// and the mode owes source's answer rather than live's (live-mode.md § 4.3). Miss-analysis: the
// fork was written as hiding-versus-painting, and no case asked a rung that hides in general
// while revealing exactly the surface being written to.
describe('the preview rungs write what source writes', () => {
	it.each(['preview-block', 'preview-inline'] as const)(
		'writes an unverified wrap where the marker-hiding fork declines (%s)',
		(mode) => {
			const at = (raw: string, selection: { start: number; end: number }) =>
				toggleInlineFormat({ display: raw, content: whole(raw), selection }, 'strong', mode);
			expect(at('*ab*', { start: 0, end: 1 })?.newDisplay).toBe('*****ab*');
			expect(live('*ab*', { start: 0, end: 1 }, 'strong')).toBeNull();
		}
	);
});

describe('source mode reads a run through the space beside it', () => {
	const source = (raw: string, selection: { start: number; end: number }) =>
		toggleInlineFormat({ display: raw, content: whole(raw), selection }, 'strong', 'source');

	// Painted delimiters put the run's own bytes inside the selection, which is the same reading
	// past a boundary space that live takes over hidden ones.
	it('strips a run the selection reaches past by a space', () => {
		expect(source('a **b** c', { start: 1, end: 7 })?.newDisplay).toBe('a b c');
		expect(source('a **b** c', { start: 2, end: 8 })?.newDisplay).toBe('a b c');
	});
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/components/blocks/text/format-toggle';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import { MARK_FORMATS, markersOf, whole } from './format-toggle-fixture';

// What a toggle may write where the delimiters do not paint: the bytes are a candidate until the
// render path agrees the screen still reads the same (live-mode.md § 2). Markdown opens and closes
// a run against a word and never whitespace, so a selection carrying a boundary space is where the
// literal wrap fails that check. Miss-analysis: every toggle case selected a bare word, so none
// ever handed the seam a slice markdown refuses to wrap — and the seam verified nothing, so the
// suite had nothing to catch it with.

const live = (raw: string, selection: { start: number; end: number }, format: InlineMarkKind) =>
	toggleInlineFormat({ display: raw, content: whole(raw), selection }, format, 'live');

const screenOf = (display: string) =>
	renderedText(parseInline(display, 0, display.length), display, CONTENT_VISIBILITY);

describe('a live toggle over a selection with boundary whitespace', () => {
	// The contract every mark owes, whatever its delimiters can enclose: a toggle changes
	// formatting and never the text on screen.
	it.each(MARK_FORMATS)('leaves the screen exactly as it was (%s)', (format) => {
		const trailing = live('hello world', { start: 0, end: 6 }, format);
		expect(screenOf(trailing!.newDisplay)).toBe('hello world');
		const leading = live('hello world', { start: 5, end: 11 }, format);
		expect(screenOf(leading!.newDisplay)).toBe('hello world');
	});

	// The three symmetric runs cannot hold the space, so it goes to the text beside them — the
	// reading `live-split-rebalance` takes at the same problem.
	it.each(['strong', 'emphasis', 'strikethrough'] as const)(
		'hands a boundary space to the text beside the run (%s)',
		(format) => {
			const m = markersOf(format);
			const trailing = live('hello world', { start: 0, end: 6 }, format);
			expect(trailing?.newDisplay).toBe(`${m}hello${m} world`);
			expect(trailing?.newDisplay.slice(trailing.newSelStart, trailing.newSelEnd)).toBe(
				`${m}hello${m}`
			);
			expect(live('hello world', { start: 5, end: 11 }, format)?.newDisplay).toBe(
				`hello ${m}world${m}`
			);
			expect(live('a hello b', { start: 1, end: 8 }, format)?.newDisplay).toBe(`a ${m}hello${m} b`);
		}
	);

	// A code span CAN hold the space, and its background paints over it, so the literal reading is
	// the true one there rather than a run the parse would break.
	it('keeps a boundary space inside a code span', () => {
		expect(live('hello world', { start: 0, end: 6 }, 'inlineCode')?.newDisplay).toBe(
			'`hello `world'
		);
		expect(live('a b', { start: 1, end: 2 }, 'inlineCode')?.newDisplay).toBe('a` `b');
	});

	// Nothing left to wrap once the space goes, and a pair over a space is no run markdown reads:
	// the only sound answer is no write at all (§ 2's fallback for a seam whose candidates fail).
	it.each(['strong', 'emphasis', 'strikethrough'] as const)(
		'declines a whitespace-only selection (%s)',
		(format) => {
			expect(live('a b', { start: 1, end: 2 }, format)).toBeNull();
		}
	);

	// The check is over the SCREEN, not over the delimiter count: a wrap beside a run the reader
	// already sees leaves that run exactly where it was, so the write stands.
	it('writes a wrap beside painted literal text', () => {
		expect(live('**word', { start: 2, end: 6 }, 'strong')?.newDisplay).toBe('****word**');
	});
});

// The preview rungs hide markers everywhere EXCEPT the block the caret is in, and a toggle only
// ever writes into the block the caret is in — so the delimiters this seam mints DO paint there,
// and the mode owes source's answer rather than live's (live-mode.md § 4.3). Miss-analysis: the
// fork was written as hiding-versus-painting, and no case asked a rung that hides in general
// while revealing exactly the surface being written to.
describe('the preview rungs write what source writes', () => {
	it.each(['preview-block', 'preview-inline'] as const)(
		'keeps a boundary space inside the run rather than dead-keying (%s)',
		(mode) => {
			const at = (raw: string, selection: { start: number; end: number }) =>
				toggleInlineFormat({ display: raw, content: whole(raw), selection }, 'strong', mode);
			expect(at('hello world', { start: 0, end: 6 })?.newDisplay).toBe('**hello **world');
			expect(at('a b', { start: 1, end: 2 })?.newDisplay).toBe('a** **b');
		}
	);
});

describe('source mode writes the same bytes it always did', () => {
	const source = (raw: string, selection: { start: number; end: number }) =>
		toggleInlineFormat({ display: raw, content: whole(raw), selection }, 'strong', 'source');

	// Painted delimiters are that mode's whole point: the reader sees the run and can fix it.
	it('keeps the boundary space inside the run', () => {
		expect(source('hello world', { start: 0, end: 6 })?.newDisplay).toBe('**hello **world');
		expect(source('a b', { start: 1, end: 2 })?.newDisplay).toBe('a** **b');
	});
});

import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/components/blocks/text/format-toggle';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';

// A toggle may only write inside the block's CONTENT range: a heading's `# ` prefix and a setext
// underline are structural bytes, and markers spliced into them change the block's KIND.
// Miss-analysis: every case here passed offsets a caret can genuinely reach, but no test ever
// handed the toggle a range outside the content — the whole display was assumed editable.

const HEADING = '## Head';
const HEADING_CONTENT = { start: 3, end: HEADING.length };
const SETEXT = 'Title\n=====';
const SETEXT_CONTENT = { start: 0, end: 5 };

const FORMATS: InlineMarkKind[] = ['strong', 'emphasis', 'strikethrough', 'inlineCode'];

describe('toggleInlineFormat clamps to the content range', () => {
	it.each(FORMATS)('a caret inside a heading prefix writes after it (%s)', (format) => {
		const r = toggleInlineFormat(
			{ display: HEADING, content: HEADING_CONTENT, selection: { start: 1, end: 1 } },
			format
		);
		expect(r.newDisplay.startsWith('## ')).toBe(true);
		expect(r.newSelStart).toBeGreaterThanOrEqual(HEADING_CONTENT.start);
	});

	it('a caret past a setext content end writes before the underline', () => {
		const r = toggleInlineFormat(
			{ display: SETEXT, content: SETEXT_CONTENT, selection: { start: 8, end: 8 } },
			'strong'
		);
		expect(r.newDisplay).toBe('Title****\n=====');
		expect(r.newSelStart).toBe(7);
	});

	it('a selection overhanging the prefix wraps only the content it covers', () => {
		const r = toggleInlineFormat(
			{ display: HEADING, content: HEADING_CONTENT, selection: { start: 0, end: 7 } },
			'strong'
		);
		expect(r.newDisplay).toBe('## **Head**');
	});

	it('a selection overhanging the setext underline stops at the content end', () => {
		const r = toggleInlineFormat(
			{ display: SETEXT, content: SETEXT_CONTENT, selection: { start: 0, end: 11 } },
			'strikethrough'
		);
		expect(r.newDisplay).toBe('~~Title~~\n=====');
	});

	// The parse must read the content range too: an underline that scanned as inline content
	// would let a construct straddle the structural bytes.
	it('unwraps a span inside the content without touching the underline', () => {
		const raw = '**Title**\n=====';
		const r = toggleInlineFormat(
			{ display: raw, content: { start: 0, end: 9 }, selection: { start: 4, end: 4 } },
			'strong'
		);
		expect(r.newDisplay).toBe('Title\n=====');
	});
});

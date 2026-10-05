// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { MARK_FORMATS, markersOf, whole } from './format-toggle-fixture';
import { renderOptions } from '../../harness/fixture-grammar';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// Where delimiters are hidden, a write stands only if the screen reads the same (live-mode.md § 2).
// Miss-analysis: every toggle case selected a bare word, never a slice markdown refuses to wrap.

const live = (raw: string, selection: { start: number; end: number }, format: InlineMarkKind) =>
	toggleInlineFormat(
		{ display: raw, content: whole(raw), selection, reading: fixtureReading({}, 'live') },
		format
	);

const screenOf = (display: string) =>
	renderedText(
		parseInline(display, 0, display.length),
		display,
		CONTENT_VISIBILITY,
		renderOptions()
	);

describe('a live toggle verifies its bytes against the screen', () => {
	// The contract every mark must keep, whatever its delimiters can enclose: a toggle changes
	// formatting and never the text on screen.
	it.each(MARK_FORMATS)('leaves the screen exactly as it was (%s)', (format) => {
		const trailing = live('hello world', { start: 0, end: 6 }, format);
		expect(screenOf(trailing!.newDisplay)).toBe('hello world');
		const leading = live('hello world', { start: 5, end: 11 }, format);
		expect(screenOf(leading!.newDisplay)).toBe('hello world');
	});

	// The check is over the screen, not the delimiter count: a wrap beside a run the user
	// already sees leaves that run exactly where it was, so the write stands.
	it('writes a wrap beside painted literal text', () => {
		expect(live('**word', { start: 2, end: 6 }, 'strong')?.newDisplay).toBe('****word**');
	});
});

// The wrap leaves the boundary space outside, so a second toggle on that selection must unwrap.
// Miss-analysis: no test ever toggled twice on one selection.
describe('a toggle takes back the wrap that same selection wrote', () => {
	// The three on-screen readings of one run with its neighbouring spaces: ` b `, ` b` and `b `,
	// whose endpoints sit on the run's content here, since live mode shows no delimiter to select.
	it.each(MARK_FORMATS)('strips through a space on either flank (%s)', (format) => {
		const m = markersOf(format).length;
		const raw = `a ${markersOf(format)}b${markersOf(format)} c`;
		expect(live(raw, { start: 1, end: 4 + 2 * m }, format)?.newDisplay).toBe('a b c');
		expect(live(raw, { start: 1, end: 3 + m }, format)?.newDisplay).toBe('a b c');
		expect(live(raw, { start: 2 + m, end: 4 + 2 * m }, format)?.newDisplay).toBe('a b c');
	});

	// The strip re-reads the construct rather than the shortcut's own row, so an author's `_`
	// survives a toggle that would have written `*`.
	it('keeps the run selected and the author’s delimiters unwritten', () => {
		const stripped = live('pre _mid_ post', { start: 3, end: 8 }, 'emphasis');
		expect(stripped?.newDisplay).toBe('pre mid post');
		expect(stripped?.newDisplay.slice(stripped.newSelStart, stripped.newSelEnd)).toBe('mid');
	});
});

// Preview modes show the written block's markers, so they write as source (live-mode.md § 4.3).
// Miss-analysis: no case asked a mode that hides markers except in the block being written.
describe('the preview inline syntax handlers write what source writes', () => {
	it.each(['preview-block', 'preview-inline'] as const)(
		'writes an unverified wrap where the marker-hiding fork declines (%s)',
		(mode) => {
			const at = (raw: string, selection: { start: number; end: number }) =>
				toggleInlineFormat(
					{
						display: raw,
						content: whole(raw),
						selection,
						reading: fixtureReading({}, mode)
					},
					'strong'
				);
			expect(at('*ab*', { start: 0, end: 1 })?.newDisplay).toBe('*****ab*');
			expect(live('*ab*', { start: 0, end: 1 }, 'strong')).toBeNull();
		}
	);
});

describe('source mode reads a run through the space beside it', () => {
	const source = (raw: string, selection: { start: number; end: number }) =>
		toggleInlineFormat(
			{ display: raw, content: whole(raw), selection, reading: fixtureReading() },
			'strong'
		);

	// Visible delimiters put the run's own bytes inside the selection, the same reading past a
	// boundary space that live mode takes over hidden ones.
	it('strips a run the selection reaches past by a space', () => {
		expect(source('a **b** c', { start: 1, end: 7 })?.newDisplay).toBe('a b c');
		expect(source('a **b** c', { start: 2, end: 8 })?.newDisplay).toBe('a b c');
	});
});

// The DOM reads a range ending on a hidden run back as any boundary of that run.
// Miss-analysis: no test chained live toggles, each fed the range the one before handed back.
describe('a chain of live toggles, each on the range the last one handed back', () => {
	function chain(raw: string, word: string, formats: InlineMarkKind[]): string[] {
		let display = raw;
		let selection = { start: raw.indexOf(word), end: raw.indexOf(word) + word.length };
		return formats.map((format) => {
			const result = live(display, selection, format);
			if (!result) return 'declined';
			display = result.newDisplay;
			selection = { start: result.newSelStart, end: result.newSelEnd };
			return `${display} [${display.slice(selection.start, selection.end)}]`;
		});
	}

	it.each([
		[
			'a word b',
			['strong', 'emphasis', 'strong', 'emphasis'],
			['a **word** b', 'a ***word*** b', 'a *word* b', 'a word b']
		],
		[
			'a word b',
			['strong', 'strikethrough', 'strong', 'strikethrough'],
			['a **word** b', 'a ~~**word**~~ b', 'a ~~word~~ b', 'a word b']
		],
		['a **bold word** b', ['emphasis', 'emphasis'], ['a **bold *word*** b', 'a **bold word** b']]
	] as const)('%s: %j', (raw, formats, displays) => {
		expect(chain(raw, 'word', [...formats])).toEqual(displays.map((d) => `${d} [word]`));
	});
});

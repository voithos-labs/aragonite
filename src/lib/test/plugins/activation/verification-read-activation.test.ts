// @vitest-environment jsdom
// Miss-analysis: the reparsing checks only ran with every plugin active, where any grammar agrees.
import { describe, expect, it, beforeEach } from 'vitest';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { FOOTNOTE_REF_KIND, registeredFootnotes } from '#lib/test/harness/registered-footnotes.js';
import { MATH_INLINE, registeredMath } from '#lib/test/harness/registered-math.js';
import { parseInline } from '#lib/core/inline/index.js';
import { screenVisibility } from '#lib/core/inline/visibility.js';
import { canWrapRangeAsLink } from '#lib/core/inline/link-source-bytes.js';
import { resolveMarkedInsertion } from '#lib/components/blocks/text/pending-mark-insert.js';
import { hiddenEdges } from '#lib/components/blocks/text/edge-seat.js';
import { resolveEdgeDeletion } from '#lib/components/blocks/text/construct-edge-delete.js';
import { makeBlockNode } from '#lib/core/nodes.js';
import { grammarListing } from './grammar-listing';
import { fixtureReading, topLevelStore } from '#lib/test/harness/fixture-grammar.js';

beforeEach(() => {
	installPlugins([registeredMath(), registeredFootnotes()]);
});

/** An editor that lists neither latex nor footnotes, so it draws `$x$` and `[^note]` as text. */
const withoutEither = () => grammarListing([]);
const LIVE = screenVisibility('live', { chromePaints: false });
const inlinesOf = (raw: string) => parseInline(raw, 0, raw.length, undefined, withoutEither());

// Without the installs every editor draws `$x$` and `[^note]` as text, and the cases below pass.
describe('the installed plugins read their syntax', () => {
	it('parses `$x$` and `[^note]` as their constructs where every plugin is listed', () => {
		const kinds = parseInline('a $x$ [^note]', 0, 13).map((node) => node.kind);
		expect(kinds).toEqual(expect.arrayContaining([MATH_INLINE, FOOTNOTE_REF_KIND]));
	});
});

describe('the link wrap reads the syntax the editor draws', () => {
	it('wraps `a [^note] b`, which the editor draws as text', () => {
		expect(
			canWrapRangeAsLink('a [^note] b', 0, 11, fixtureReading({ grammar: withoutEither() }))
		).toBe(true);
	});
});

describe('a pending mark reads the syntax the editor draws', () => {
	it('bolds a byte typed inside `$x$`', () => {
		const raw = 'a $x$ b';
		const marked = resolveMarkedInsertion(
			raw,
			4,
			'y',
			new Set(['strong'] as const),
			inlinesOf(raw),
			fixtureReading({ grammar: withoutEither() })
		);
		expect(marked).toEqual({ raw: 'a $x**y**$ b', caret: 7 });
	});
});

describe('the typing position at a hidden run reads the syntax the editor draws', () => {
	// `**[^note**`: typing `]` inside the bold spells a reference only where footnotes is listed.
	it('keeps the typed byte at the caret inside the bold', () => {
		const raw = '**[^note**';
		const reading = fixtureReading({ grammar: withoutEither() });
		const edges = hiddenEdges(inlinesOf(raw), raw, LIVE, reading);
		expect(edges.typingOffset(8, null, ']')).toBe(8);
	});
});

describe('the edge delete reads the syntax the editor draws', () => {
	// Deleting the bold `x` leaves `[^note]`, which reads as text here, not as a reference.
	const deleteBoldX = (kind: 'paragraph' | 'tableCell') => {
		const raw = '[^note**x**]';
		const node = makeBlockNode({ kind, leadingTrivia: '', raw });
		return resolveEdgeDeletion({
			display: raw,
			asWritten: (text) => text,
			content: { start: 0, end: raw.length },
			caret: 9,
			direction: 'backward',
			screen: LIVE,
			inlines: inlinesOf(raw),
			store: topLevelStore(node, fixtureReading({ grammar: withoutEither() }))
		});
	};

	it('takes the byte in a table cell', () => {
		expect(deleteBoldX('tableCell')).toMatchObject({ raw: '[^note]', caret: 6 });
	});

	it('takes the byte in a prose block', () => {
		expect(deleteBoldX('paragraph')).toMatchObject({ raw: '[^note]', caret: 6 });
	});
});

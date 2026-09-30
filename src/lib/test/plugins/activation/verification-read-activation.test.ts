// @vitest-environment jsdom
// Miss-analysis: the reparsing checks only ran with every plugin active, where any grammar agrees.
import { describe, expect, it, beforeEach } from 'vitest';
import { installPlugins } from '$lib/schema/plugin-install';
import { EMOJI_KIND, emojiPlugin } from '$lib/plugins/emoji';
import { MATH_INLINE, latexPlugin } from '$lib/plugins/latex';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import { canWrapRangeAsLink } from '$lib/core/inline/link-source-bytes';
import { resolveMarkedInsertion } from '$lib/components/blocks/text/pending-mark-insert';
import { resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import { resolveEdgeDeletion } from '$lib/components/blocks/text/construct-edge-delete';
import { makeBlockNode } from '$lib/core/nodes';
import { grammarListing } from './grammar-listing';
import { fixtureReading, topLevelStore } from '$lib/test/harness/fixture-grammar';

beforeEach(() => {
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		emojiPlugin()
	]);
});

/** An editor that lists neither latex nor emoji, so it draws `$x$` and `:smile:` as text. */
const withoutEither = () => grammarListing([]);
const LIVE = screenVisibility('live', { chromePaints: false });
const inlinesOf = (raw: string) => parseInline(raw, 0, raw.length, undefined, withoutEither());

// Without the installs every editor draws `$x$` and `:smile:` as text, and the cases below pass.
describe('the installed plugins read their syntax', () => {
	it('parses `$x$` and `:smile:` as their constructs where every plugin is listed', () => {
		const kinds = parseInline('a $x$ :smile:', 0, 13).map((node) => node.kind);
		expect(kinds).toEqual(expect.arrayContaining([MATH_INLINE, EMOJI_KIND]));
	});
});

describe('the link wrap reads the syntax the editor draws', () => {
	it('wraps `a :smile: b`, which the editor draws as text', () => {
		expect(
			canWrapRangeAsLink('a :smile: b', 0, 11, fixtureReading({ grammar: withoutEither() }))
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
	// `**:smile**`: typing `:` inside the bold spells an emoji only where emoji is listed.
	it('keeps the typed byte at the caret inside the bold', () => {
		const raw = '**:smile**';
		const seat = resolveEdgeSeat(
			8,
			inlinesOf(raw),
			'near',
			raw,
			LIVE,
			':',
			fixtureReading({ grammar: withoutEither() })
		);
		expect(seat).toBeNull();
	});
});

describe('the edge delete reads the syntax the editor draws', () => {
	// Deleting the bold `x` leaves `:smile:`, which reads as text here, not as an emoji.
	const deleteBoldX = (kind: 'paragraph' | 'tableCell') => {
		const raw = ':smile**x**:';
		const node = makeBlockNode({ kind, leadingTrivia: '', raw });
		return resolveEdgeDeletion({
			display: raw,
			content: { start: 0, end: raw.length },
			caret: 9,
			direction: 'backward',
			screen: LIVE,
			inlines: inlinesOf(raw),
			store: topLevelStore(node, fixtureReading({ grammar: withoutEither() }))
		});
	};

	it('takes the byte in a table cell', () => {
		expect(deleteBoldX('tableCell')).toMatchObject({ raw: ':smile:', caret: 6 });
	});

	it('takes the byte in a prose block', () => {
		expect(deleteBoldX('paragraph')).toMatchObject({ raw: ':smile:', caret: 6 });
	});
});

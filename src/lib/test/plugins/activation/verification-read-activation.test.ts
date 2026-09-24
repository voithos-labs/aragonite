// @vitest-environment jsdom
//
// Miss-analysis: the link-wrap, pending-mark, typing-position and edge-delete suites ran with every
// installed plugin active, so a check reparsing with the wrong grammar agreed with the render.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { installPlugins } from '$lib/schema/plugin-install';
import { emojiPlugin } from '$lib/plugins/emoji';
import { latexPlugin } from '$lib/plugins/latex';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import { canWrapRangeAsLink } from '$lib/components/blocks/text/link-source-bytes';
import { resolveMarkedInsertion } from '$lib/components/blocks/text/pending-mark-insert';
import { resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import {
	resolveEdgeDeletion,
	type EdgeDeletionSurface
} from '$lib/components/blocks/text/construct-edge-delete';
import { grammarListing } from './grammar-listing';

beforeAll(() => {
	resetPluginPlatformForTests();
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		emojiPlugin()
	]);
});
afterAll(resetPluginPlatformForTests);

/** An editor that lists neither latex nor emoji, so it draws `$x$` and `:smile:` as text. */
const withoutEither = () => grammarListing([]);
const LIVE = screenVisibility('live', { chromePaints: false });
const inlinesOf = (raw: string) => parseInline(raw, 0, raw.length, undefined, withoutEither());

describe('the link wrap reads the syntax the editor draws', () => {
	it('wraps `a :smile: b`, which the editor draws as text', () => {
		expect(canWrapRangeAsLink('a :smile: b', 0, 11, { grammar: withoutEither() })).toBe(true);
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
			undefined,
			withoutEither()
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
			undefined,
			withoutEither()
		);
		expect(seat).toBeNull();
	});
});

describe('the edge delete reads the syntax the editor draws', () => {
	// Deleting the bold `x` leaves `:smile:`, which reads as text here, not as an emoji.
	const deleteBoldX = (installedAs: EdgeDeletionSurface) => {
		const raw = ':smile**x**:';
		return resolveEdgeDeletion({
			display: raw,
			content: { start: 0, end: raw.length },
			caret: 9,
			direction: 'backward',
			screen: LIVE,
			inlines: inlinesOf(raw),
			installedAs,
			resolver: undefined,
			grammar: withoutEither()
		});
	};

	it('takes the byte in a table cell', () => {
		expect(deleteBoldX('cell')).toMatchObject({ raw: ':smile:', caret: 6 });
	});

	it('takes the byte in a prose block', () => {
		expect(deleteBoldX('block')).toMatchObject({ raw: ':smile:', caret: 6 });
	});
});

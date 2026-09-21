// @vitest-environment jsdom
/**
 * The kit's cells are only worth their runtime if they can fail. Each case here registers an
 * inline handler with one deliberate defect and asserts the cell that owns it fails, naming
 * it; the enrollment suite beside it proves the other direction.
 *
 * The defects are invisible to a byte round trip, which is the whole reason the cells exist:
 * every document below round-trips perfectly while meaning something other than what its
 * author wrote.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	mintWidgetShell,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
	type InlineWidgetEditingPolicy,
	type PluginInlineKind
} from '$lib/plugin';
import { resetPluginPlatformForTests, runInlineKindConformance } from '$lib/testing';
import type { InlineConformanceProfile } from '$lib/testing';
import { registerWikiRung, rewriteWikiImage } from '../image/wiki-image-rung';

beforeEach(() => resetPluginPlatformForTests());
afterEach(() => resetPluginPlatformForTests());

const A_REASON = 'a substantive reason long enough to clear the documented-excuse floor';

const wikiProfile = (over: Partial<InlineConformanceProfile> = {}): InlineConformanceProfile => ({
	trigger: '!',
	prefix: '![[',
	fixtures: ['![[cat.png]]', '![[cat.png|300]]'],
	overlapFixtures: ['![[a]](u)'],
	overlapDecline: { mode: 'assert' },
	widget: { mode: 'exempt', reason: A_REASON },
	editingPolicy: { mode: 'exempt', reason: A_REASON },
	imageClaim: { mode: 'assert' },
	...over
});

const run = (profile: InlineConformanceProfile) => () => runInlineKindConformance(profile);

// ── overlapDecline: the flagship ─────────────────────────────────────────────

describe('overlapDecline reds an inline syntax handler that swallows the grammar overlap', () => {
	// `![[a]](u)` is a built-in image, and a handler registered on the `!` prefix is asked
	// first, so a recognizer taking every `![[…]]` takes those bytes and the document still
	// round-trips, as a wiki embed the author never wrote.
	const swallowEverything = (raw: string, pos: number, end: number): InlineNode | null => {
		const close = raw.indexOf(']]', pos + 3);
		if (!raw.startsWith('![[', pos) || close < 0 || close + 2 > end) return null;
		return {
			kind: 'image',
			start: pos,
			end: close + 2,
			alt: raw.slice(pos + 3, close),
			url: raw.slice(pos + 3, close)
		};
	};

	it('fails the overlap cell, naming the claim it should have refused', () => {
		registerInlineSyntax('!', swallowEverything, {
			prefix: '![[',
			priority: INLINE_PRIORITIES.prefixOverride,
			rewriteImage: rewriteWikiImage
		});
		expect(run(wikiProfile())).toThrow(/overlapDecline: .*swallowed the overlap/s);
	});

	it('passes for the same inline syntax handler once it declines the overlap itself', () => {
		registerWikiRung(rewriteWikiImage);
		const report = runInlineKindConformance(wikiProfile());
		expect(report.cells.find((c) => c.cell === 'overlapDecline')?.status).toBe('asserted');
	});

	// A handler on a reserved trigger always outranks the built-in case, so there is
	// always an overlap and nothing to excuse.
	it('refuses an exemption on a reserved trigger outright', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ overlapDecline: { mode: 'exempt', reason: A_REASON } }))).toThrow(
			/overlapDecline cannot be exempt on a reserved trigger/
		);
	});
});

// ── imageClaim ───────────────────────────────────────────────────────────────

describe('imageClaim reds a borrowed built-in the inline syntax handler cannot re-serialize', () => {
	it('fails when the inline syntax handler creates an image with no rewriteImage hook', () => {
		registerWikiRung();
		expect(run(wikiProfile())).toThrow(/imageClaim: .*registers no rewriteImage/s);
	});

	it('fails an exemption the fixtures contradict', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ imageClaim: { mode: 'exempt', reason: A_REASON } }))).toThrow(
			/imageClaim: .*cannot be excused/s
		);
	});

	// A hook that cannot re-emit the node it was handed cannot be trusted with an edited
	// one, and a rewrite equal to the source is dropped by the commit's equality check,
	// so the edit would visibly do nothing and say nothing.
	it('fails a hook that cannot reproduce its own input', () => {
		registerWikiRung(() => '![[somethingelse.png]]');
		expect(run(wikiProfile())).toThrow(/imageClaim: .*rewriteImage re-emits/s);
	});
});

// ── claims: the anti-vacuity pin ─────────────────────────────────────────────

describe('claims reds a fixture the inline syntax handler never touches', () => {
	it('fails enrollment rather than passing every cell over nothing', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ fixtures: ['![[cat.png]]', 'plain prose'] }))).toThrow(
			/claims: .*is not claimed by the "!\[\[" rung/s
		);
	});

	it('refuses a profile with no fixtures at all', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ fixtures: [] }))).toThrow(/at least one fixture/);
	});
});

// ── registration ─────────────────────────────────────────────────────────────

describe('registration reds an inline syntax handler that is not where the profile says', () => {
	// The failure the directive handler shipped with: the kind and widget registered,
	// the recognizer skipped because another plugin already held the trigger.
	it('fails when nothing is registered at the declared prefix', () => {
		expect(run(wikiProfile())).toThrow(/no rung is registered on "!" at prefix "!\[\["/);
	});
});

// ── widget ───────────────────────────────────────────────────────────────────

const MARKER = 'marker';

function registerMarkerRung(
	build: (node: InlineNode) => HTMLElement,
	editing: InlineWidgetEditingPolicy = { deleteGranularity: 'atomic', onEdge: 'step-over' }
): PluginInlineKind {
	const kind = declarePluginInlineKind(MARKER);
	registerInlineSyntax('@', (raw, pos, end) => {
		const close = raw.indexOf('@', pos + 1);
		if (close < 0 || close + 1 > end || close === pos + 1) return null;
		return { kind, start: pos, end: close + 1 };
	});
	registerInlineWidgetKind(kind, { isWidget: () => true, buildWidget: build, editing });
	return kind;
}

const markerProfile = (kind: PluginInlineKind): InlineConformanceProfile => ({
	trigger: '@',
	kind,
	fixtures: ['@tag@', 'a @tag@ b'],
	overlapDecline: { mode: 'exempt', reason: A_REASON },
	widget: { mode: 'assert' },
	editingPolicy: { mode: 'assert' },
	imageClaim: { mode: 'exempt', reason: A_REASON }
});

describe('editingPolicy reds a declaration that decides nothing', () => {
	// The caret-edge dispatch reads an all-absent object exactly as an unregistered one, so
	// without this a kind clears the cell with a policy that moves no byte.
	it('fails an editing policy whose every field is absent', () => {
		const kind = registerMarkerRung((node) => mintWidgetShell(MARKER, node), {});
		expect(run(markerProfile(kind))).toThrow(/editingPolicy: .*every field absent/s);
	});
});

describe('widget reds a widget the offset walk cannot measure', () => {
	it('passes for a widget created through the shared shell', () => {
		const kind = registerMarkerRung((node) => mintWidgetShell('marker', node));
		const report = runInlineKindConformance(markerProfile(kind));
		expect(report.cells.find((c) => c.cell === 'widget')?.status).toBe('asserted');
	});

	// Every caret offset in the block comes from the DOM-to-offset traversal, and no byte
	// moves when the span is wrong: the block simply stops agreeing with its own bytes.
	it('fails a widget whose source span is short by one', () => {
		const kind = registerMarkerRung((node) => {
			const shell = mintWidgetShell('marker', node);
			shell.dataset.sourceEnd = String(node.end - 1);
			return shell;
		});
		expect(run(markerProfile(kind))).toThrow(/widget: .*data-source-end/s);
	});

	it('fails a widget that is not marked atomic at all', () => {
		const kind = registerMarkerRung(() => document.createElement('span'));
		expect(run(markerProfile(kind))).toThrow(/widget: .*data-inline-widget/s);
	});
});

describe('widget reds a claim that cannot stand on its own bytes', () => {
	// The match reaches for a byte outside itself, so the slice `data-source-*` hands the
	// clipboard, and showing the source does not re-form the same widget.
	it('fails an inline syntax handler whose slice only forms in the context it was cut from', () => {
		const kind = declarePluginInlineKind(MARKER);
		registerInlineSyntax('@', (raw, pos, end) => {
			if (raw.indexOf('!', pos + 2) < 0 || pos + 2 > end) return null;
			return { kind, start: pos, end: pos + 2 };
		});
		registerInlineWidgetKind(kind, {
			isWidget: () => true,
			buildWidget: (node) => mintWidgetShell('marker', node),
			editing: { deleteGranularity: 'atomic' }
		});
		expect(run({ ...markerProfile(kind), fixtures: ['@x!'] })).toThrow(
			/widget: .*re-forms as a whole/s
		);
	});
});

// ── roundTrip ────────────────────────────────────────────────────────────────

// A block's scan range is not always its whole raw, so a handler reading the string instead
// of the range swallows marker bytes into its widget's span and shifts every later caret. The
// dispatch already throws on such a match; what the kit decides is when the author hears about
// it, so these pin that it drives a restricted range at all. Otherwise the handler is only
// caught in the consumer's app, at the first heading.
describe('roundTrip reds a claim that reads past the range the block offered', () => {
	/** Registers `@…@` with a recognizer of the caller's shape that ignores `end`. */
	function registerOverrunningRung(
		claimEnd: (raw: string, pos: number) => number | null
	): PluginInlineKind {
		const kind = declarePluginInlineKind(MARKER);
		registerInlineSyntax('@', (raw, pos) => {
			const end = claimEnd(raw, pos);
			return end === null ? null : { kind, start: pos, end };
		});
		registerInlineWidgetKind(kind, {
			isWidget: () => true,
			buildWidget: (node) => mintWidgetShell('marker', node),
			editing: { deleteGranularity: 'atomic' }
		});
		return kind;
	}

	// The grab-to-end shape: it stops at no terminator, so bytes carrying none of the
	// author's grammar are enough to reach it.
	it('fails a claim that runs to the end of the string', () => {
		const kind = registerOverrunningRung((raw) => raw.length);
		expect(run({ ...markerProfile(kind), fixtures: ['@tag@'] })).toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});

	// The terminator-search shape stops at a real closer, so only a tail carrying the
	// author's own grammar puts one beyond `end`, which is why the kit also cuts the
	// range just past an opener.
	it('fails a terminator search with no `end` bound', () => {
		const kind = registerOverrunningRung((raw, pos) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close === pos + 1 ? null : close + 1;
		});
		expect(run({ ...markerProfile(kind), fixtures: ['@tag@'] })).toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});

	// With leading prose the cut has to find the opener rather than assume offset 0, or
	// the range ends inside the prose and no handler is asked at the boundary.
	it('fails a terminator search behind a fixture with leading prose', () => {
		const kind = registerOverrunningRung((raw, pos) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close === pos + 1 ? null : close + 1;
		});
		expect(run({ ...markerProfile(kind), fixtures: ['ab @tag@ cd'] })).toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});
});

// ── editingPolicy ────────────────────────────────────────────────────────────

describe('editingPolicy reds a declaration the caret-edge dispatch cannot read', () => {
	it('fails a deleteGranularity outside the dispatch vocabulary', () => {
		const kind = registerMarkerRung((node) => mintWidgetShell('marker', node), {
			// Read as absent by the dispatch, so the kind silently takes the image default.
			deleteGranularity: 'whole' as 'atomic'
		});
		expect(run(markerProfile(kind))).toThrow(/editingPolicy: .*deleteGranularity is one of/s);
	});

	it('fails an exemption a live policy contradicts', () => {
		const kind = registerMarkerRung((node) => mintWidgetShell('marker', node));
		expect(
			run({ ...markerProfile(kind), editingPolicy: { mode: 'exempt', reason: A_REASON } })
		).toThrow(/editingPolicy: .*cannot be excused/s);
	});
});

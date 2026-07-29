// @vitest-environment jsdom
/**
 * The kit's cells are only worth their runtime if they can red. Each case here
 * registers a rung with one deliberate defect and asserts the cell that owns it
 * fails, naming it — the enrollment suite next door proves the other direction.
 *
 * Defects are chosen to be invisible to byte round-trip, which is the whole reason
 * the cells exist: every document below round-trips perfectly while meaning
 * something other than what its author wrote.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	mintWidgetShell,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
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

describe('overlapDecline reds a rung that swallows the grammar overlap', () => {
	// `![[a]](u)` is a built-in image whose alt text is `[a]`. A prefix rung on `!` is
	// consulted BEFORE the image case, so a recognizer that claims every `![[…]]`
	// takes those bytes off the built-in — and the document still round-trips, as a
	// wiki embed the author never wrote.
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

	it('passes for the same rung once it declines the overlap itself', () => {
		registerWikiRung(rewriteWikiImage);
		const report = runInlineKindConformance(wikiProfile());
		expect(report.cells.find((c) => c.cell === 'overlapDecline')?.status).toBe('asserted');
	});

	// A reserved trigger's rung outranks a built-in case by construction, so there is
	// always an overlap and nothing to excuse.
	it('refuses an exemption on a reserved trigger outright', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ overlapDecline: { mode: 'exempt', reason: A_REASON } }))).toThrow(
			/overlapDecline cannot be exempt on a reserved trigger/
		);
	});
});

// ── imageClaim ───────────────────────────────────────────────────────────────

describe('imageClaim reds a borrowed built-in the rung cannot re-serialize', () => {
	it('fails when the rung mints an image with no rewriteImage hook', () => {
		registerWikiRung();
		expect(run(wikiProfile())).toThrow(/imageClaim: .*registers no rewriteImage/s);
	});

	it('fails an exemption the fixtures contradict', () => {
		registerWikiRung(rewriteWikiImage);
		expect(run(wikiProfile({ imageClaim: { mode: 'exempt', reason: A_REASON } }))).toThrow(
			/imageClaim: .*cannot be excused/s
		);
	});

	// A hook that cannot re-emit the node it was handed cannot be trusted with an
	// edited one — and a rewrite equal to the source is dropped by the commit's
	// equality guard, so the edit would visibly do nothing with nothing to read.
	it('fails a hook that cannot reproduce its own input', () => {
		registerWikiRung(() => '![[somethingelse.png]]');
		expect(run(wikiProfile())).toThrow(/imageClaim: .*rewriteImage re-emits/s);
	});
});

// ── claims: the anti-vacuity pin ─────────────────────────────────────────────

describe('claims reds a fixture the rung never touches', () => {
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

describe('registration reds a rung that is not where the profile says', () => {
	// The failure the directive tier shipped with: the kind and widget registered,
	// the recognizer skipped because another plugin already held the trigger.
	it('fails when nothing is registered at the declared prefix', () => {
		expect(run(wikiProfile())).toThrow(/no rung is registered on "!" at prefix "!\[\["/);
	});
});

// ── widget ───────────────────────────────────────────────────────────────────

const MARKER = 'marker';

function registerMarkerRung(build: (node: InlineNode) => HTMLElement): PluginInlineKind {
	const kind = declarePluginInlineKind(MARKER);
	registerInlineSyntax('@', (raw, pos, end) => {
		const close = raw.indexOf('@', pos + 1);
		if (close < 0 || close + 1 > end || close === pos + 1) return null;
		return { kind, start: pos, end: close + 1 };
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: build,
		editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
	});
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

describe('widget reds an island the offset walk cannot measure', () => {
	it('passes for an island minted through the shared shell', () => {
		const kind = registerMarkerRung((node) => mintWidgetShell('marker', node));
		const report = runInlineKindConformance(markerProfile(kind));
		expect(report.cells.find((c) => c.cell === 'widget')?.status).toBe('asserted');
	});

	// Every caret offset in the block rides on the walk, and no byte moves when the
	// span is wrong — the block simply stops agreeing with its own bytes.
	it('fails an island whose source span is short by one', () => {
		const kind = registerMarkerRung((node) => {
			const shell = mintWidgetShell('marker', node);
			shell.dataset.sourceEnd = String(node.end - 1);
			return shell;
		});
		expect(run(markerProfile(kind))).toThrow(/widget: .*data-source-end/s);
	});

	it('fails an island that is not marked atomic at all', () => {
		const kind = registerMarkerRung(() => document.createElement('span'));
		expect(run(markerProfile(kind))).toThrow(/widget: .*data-inline-widget/s);
	});
});

describe('widget reds a claim that cannot stand on its own bytes', () => {
	// The claim reaches for a byte OUTSIDE itself, so the slice `data-source-*` hands
	// the clipboard and a source reveal does not re-form as the same widget.
	it('fails a rung whose slice only forms in the context it was cut from', () => {
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

// A block's scan range is not always its whole raw — a heading's excludes a closing
// `#` run, a table cell's excludes its `|`. A rung that reads the string instead of
// the range swallows those bytes into its widget's source span, and every caret
// offset after it is off by the difference with nothing moving in the document.
//
// The dispatch throws on such a claim, so the kit is not the enforcer here — what it
// owns is WHEN the author hears about it. These cases pin that the kit drives a
// restricted range at all: without those drives the rung is only caught at first
// render of a heading, in the consumer's app rather than in the plugin's own suite.
describe('roundTrip reds a claim that reads past the range the block offered', () => {
	/** Registers `@…@` with an `end`-unaware recognizer of the caller's shape. */
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

	// The terminator-search shape, and the reason the range is also cut just past an
	// opener: this rung stops at a real closer, so inert bytes never reach it. Only a
	// tail carrying the author's OWN grammar puts a closer beyond `end` to find, and
	// only the straddling cut guarantees an opener sits at the boundary to look from.
	it('fails a terminator search with no `end` bound', () => {
		const kind = registerOverrunningRung((raw, pos) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close === pos + 1 ? null : close + 1;
		});
		expect(run({ ...markerProfile(kind), fixtures: ['@tag@'] })).toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});

	// The same overrun behind a fixture that carries prose before its claim. The cut
	// has to LOCATE the opener rather than assume it at offset 0, or the range ends
	// inside the leading prose and no rung is consulted at the boundary at all.
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
		const kind = declarePluginInlineKind(MARKER);
		registerInlineSyntax('@', (raw, pos, end) => {
			const close = raw.indexOf('@', pos + 1);
			if (close < 0 || close + 1 > end || close === pos + 1) return null;
			return { kind, start: pos, end: close + 1 };
		});
		registerInlineWidgetKind(kind, {
			isWidget: () => true,
			buildWidget: (node) => mintWidgetShell('marker', node),
			// Read as absent by the dispatch, so the kind silently takes the image default.
			editing: { deleteGranularity: 'whole' as 'atomic' }
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

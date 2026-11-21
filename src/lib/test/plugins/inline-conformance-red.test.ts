// @vitest-environment jsdom
// The kit's cells are only worth their runtime if they can fail, so each case registers an
// inline handler with one deliberate defect and asserts the cell that owns it fails, naming it.
// Every defect is invisible to a byte round trip: each document below round-trips perfectly
// while meaning something other than what its author wrote.

import { describe, expect, it } from 'vitest';
import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
	type InlineWidgetEditingPolicy,
	type PluginInlineKind
} from '#lib/plugin.js';
import { runInlineKindConformance } from '#lib/testing.js';
import type { InlineConformanceProfile } from '#lib/testing.js';
import { registerWikiRung, rewriteWikiImage } from '../image/wiki-image-rung';

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

const run = (profile: InlineConformanceProfile) => runInlineKindConformance(profile);

// ── overlapDecline: the flagship ─────────────────────────────────────────────

describe('overlapDecline holds the editor’s decline over the grammar overlap', () => {
	// `![[a]](u)` is a built-in image, and the editor declines a claim it closes inside, so even a
	// handler taking every `![[…]]` leaves it an image.
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

	const registerSwallower = () =>
		registerInlineSyntax('!', swallowEverything, {
			prefix: '![[',
			priority: INLINE_PRIORITIES.prefixOverride,
			rewriteImage: rewriteWikiImage
		});

	it('passes a handler that swallows the overlap, which the editor declines for it', async () => {
		registerSwallower();
		const report = await runInlineKindConformance(wikiProfile());
		expect(report.cells.find((c) => c.cell === 'overlapDecline')?.status).toBe('asserted');
	});

	it('fails an overlap fixture that spells no built-in construct', async () => {
		registerSwallower();
		await expect(run(wikiProfile({ overlapFixtures: ['![[a.png]]'] }))).rejects.toThrow(
			/overlapDecline: .*no overlap/s
		);
	});

	it('passes for the same inline syntax handler once it declines the overlap itself', async () => {
		registerWikiRung(rewriteWikiImage);
		const report = await runInlineKindConformance(wikiProfile());
		expect(report.cells.find((c) => c.cell === 'overlapDecline')?.status).toBe('asserted');
	});

	// A handler on a reserved trigger always outranks the built-in case, so there is
	// always an overlap and nothing to excuse.
	it('refuses an exemption on a reserved trigger outright', async () => {
		registerWikiRung(rewriteWikiImage);
		await expect(
			run(wikiProfile({ overlapDecline: { mode: 'exempt', reason: A_REASON } }))
		).rejects.toThrow(/overlapDecline cannot be exempt on a reserved trigger/);
	});
});

// ── imageClaim ───────────────────────────────────────────────────────────────

describe('imageClaim reds a borrowed built-in the inline syntax handler cannot re-serialize', () => {
	it('fails when the inline syntax handler creates an image with no rewriteImage hook', async () => {
		registerWikiRung();
		await expect(run(wikiProfile())).rejects.toThrow(/imageClaim: .*registers no rewriteImage/s);
	});

	it('fails an exemption the fixtures contradict', async () => {
		registerWikiRung(rewriteWikiImage);
		await expect(
			run(wikiProfile({ imageClaim: { mode: 'exempt', reason: A_REASON } }))
		).rejects.toThrow(/imageClaim: .*cannot be excused/s);
	});

	// A rewrite equal to the source is dropped by the commit's equality check, so a hook that
	// cannot re-emit its own input makes an edit that visibly does nothing and says nothing.
	it('fails a hook that cannot reproduce its own input', async () => {
		registerWikiRung(() => '![[somethingelse.png]]');
		await expect(run(wikiProfile())).rejects.toThrow(/imageClaim: .*rewriteImage re-emits/s);
	});
});

// ── claims: the anti-vacuity pin ─────────────────────────────────────────────

describe('claims reds a fixture the inline syntax handler never touches', () => {
	it('fails enrollment rather than passing every cell over nothing', async () => {
		registerWikiRung(rewriteWikiImage);
		await expect(run(wikiProfile({ fixtures: ['![[cat.png]]', 'plain prose'] }))).rejects.toThrow(
			/claims: .*is not claimed by the "!\[\[" rung/s
		);
	});

	it('refuses a profile with no fixtures at all', async () => {
		registerWikiRung(rewriteWikiImage);
		await expect(run(wikiProfile({ fixtures: [] }))).rejects.toThrow(/at least one fixture/);
	});
});

// ── registration ─────────────────────────────────────────────────────────────

describe('registration reds an inline syntax handler that is not where the profile says', () => {
	// The kind and widget registered but the recognizer skipped, because another plugin
	// already held the trigger.
	it('fails when nothing is registered at the declared prefix', async () => {
		await expect(run(wikiProfile())).rejects.toThrow(
			/no rung is registered on "!" at prefix "!\[\["/
		);
	});
});

// ── widget ───────────────────────────────────────────────────────────────────

const MARKER = 'marker';

function registerMarkerRung(
	editing: InlineWidgetEditingPolicy = { deleteGranularity: 'atomic', onEdge: 'step-over' }
): PluginInlineKind {
	const kind = declarePluginInlineKind(MARKER);
	registerInlineSyntax('@', (raw, pos, end) => {
		const close = raw.indexOf('@', pos + 1);
		if (close < 0 || close + 1 > end || close === pos + 1) return null;
		return { kind, start: pos, end: close + 1 };
	});
	registerInlineWidgetKind(kind, { isWidget: () => true, view: () => ({}), editing });
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

// Miss-analysis: the excuse checks were only ever reached by profiles that asserted the cell, so
// a check that stopped refusing an excuse stayed green.
describe('an excuse the kit can disprove fails', () => {
	it('fails an excused overlapDecline whose profile supplies overlapFixtures', async () => {
		const kind = registerMarkerRung();
		await expect(run({ ...markerProfile(kind), overlapFixtures: ['a @ b'] })).rejects.toThrow(
			/overlapDecline: .*supplies overlapFixtures/s
		);
	});

	it('fails an excused widget over a registered live widget', async () => {
		const kind = registerMarkerRung();
		await expect(
			run({ ...markerProfile(kind), widget: { mode: 'exempt', reason: A_REASON } })
		).rejects.toThrow(/widget: .*is a registered live widget/s);
	});
});

describe('editingPolicy reds a declaration that decides nothing', () => {
	// The caret-edge dispatch reads an all-absent object exactly as an unregistered one, so
	// without this a kind clears the cell with a policy that moves no byte.
	it('fails an editing policy whose every field is absent', async () => {
		const kind = registerMarkerRung({});
		await expect(run(markerProfile(kind))).rejects.toThrow(/editingPolicy: .*every field absent/s);
	});
});

describe('widget asserts over a kind the editor draws a shell for', () => {
	it('passes for a registered live widget whose claims stand on their own bytes', async () => {
		const kind = registerMarkerRung();
		const report = await runInlineKindConformance(markerProfile(kind));
		expect(report.cells.find((c) => c.cell === 'widget')?.status).toBe('asserted');
	});
});

describe('widget reds a claim that cannot stand on its own bytes', () => {
	// The match reaches for a byte outside itself, so neither the slice `data-source-*` hands the
	// clipboard nor the shown source re-forms the same widget.
	it('fails an inline syntax handler whose slice only forms in the context it was cut from', async () => {
		const kind = declarePluginInlineKind(MARKER);
		registerInlineSyntax('@', (raw, pos, end) => {
			if (raw.indexOf('!', pos + 2) < 0 || pos + 2 > end) return null;
			return { kind, start: pos, end: pos + 2 };
		});
		registerInlineWidgetKind(kind, {
			isWidget: () => true,
			view: () => ({}),
			editing: { deleteGranularity: 'atomic' }
		});
		await expect(run({ ...markerProfile(kind), fixtures: ['@x!'] })).rejects.toThrow(
			/widget: .*re-forms as a whole/s
		);
	});
});

// ── roundTrip ────────────────────────────────────────────────────────────────

// A block's scan range is not always its whole raw, and a handler reading past it shifts every
// later caret; the kit drives a restricted range so the author hears before a consumer does.
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
			view: () => ({}),
			editing: { deleteGranularity: 'atomic' }
		});
		return kind;
	}

	// The grab-to-end shape: it stops at no terminator, so bytes carrying none of the
	// author's grammar are enough to reach it.
	it('fails a claim that runs to the end of the string', async () => {
		const kind = registerOverrunningRung((raw) => raw.length);
		await expect(run({ ...markerProfile(kind), fixtures: ['@tag@'] })).rejects.toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});

	// A terminator search stops at a real closer, so only a tail carrying the author's own
	// grammar puts one past `end`; the kit also cuts the range just past an opener for that.
	it('fails a terminator search with no `end` bound', async () => {
		const kind = registerOverrunningRung((raw, pos) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close === pos + 1 ? null : close + 1;
		});
		await expect(run({ ...markerProfile(kind), fixtures: ['@tag@'] })).rejects.toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});

	// With leading prose the cut has to find the opener rather than assume offset 0, or
	// the range ends inside the prose and no handler is asked at the boundary.
	it('fails a terminator search behind a fixture with leading prose', async () => {
		const kind = registerOverrunningRung((raw, pos) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close === pos + 1 ? null : close + 1;
		});
		await expect(run({ ...markerProfile(kind), fixtures: ['ab @tag@ cd'] })).rejects.toThrow(
			/roundTrip: .*past the scan range end/s
		);
	});
});

// ── editingPolicy ────────────────────────────────────────────────────────────

describe('editingPolicy reds a declaration the caret-edge dispatch cannot read', () => {
	it('fails a deleteGranularity outside the dispatch vocabulary', async () => {
		const kind = registerMarkerRung({
			// Read as absent by the dispatch, so the kind silently takes the image default.
			deleteGranularity: 'whole' as 'atomic'
		});
		await expect(run(markerProfile(kind))).rejects.toThrow(
			/editingPolicy: .*deleteGranularity is one of/s
		);
	});

	it('fails an exemption a live policy contradicts', async () => {
		const kind = registerMarkerRung();
		await expect(
			run({ ...markerProfile(kind), editingPolicy: { mode: 'exempt', reason: A_REASON } })
		).rejects.toThrow(/editingPolicy: .*cannot be excused/s);
	});
});

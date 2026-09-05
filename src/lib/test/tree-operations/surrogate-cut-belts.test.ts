// @vitest-environment jsdom
// The byte sinks that cut at a caret offset, enumerated: whoever slices `raw` at an offset a
// caret supplied owes the scalar-boundary snap, or a gesture lands half a surrogate pair in one
// block and half in another. Miss-analysis: every offset these sinks are driven with in the suite
// comes from a hand-written ASCII fixture, so an offset splitting a pair reaches them only from a
// real caret nobody simulates (#167, #105's split arm, and the three later sinks the first census
// missed by counting sinks in prose instead of by set equality).
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { snapToScalarBoundary } from '$lib/core/lines';
import { splitNode, cutRangeFromDisplay } from '$lib/tree-operations/node-ops';
import { buildPastedReplacement } from '$lib/tree-operations/paste/paste-replacement';
import { splitLeafForPaste } from '$lib/tree-operations/list/list-builders';
import { resolveSelectionEdit } from '$lib/components/blocks/text/live-selection-edit';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { createSharingState } from '$lib/tree-operations/sharing';
import { collectEditorSources } from '$lib/test/invariants/lint/scan-source';
import type { CstNode } from '$lib/core/nodes';
import type { NodeView } from '$lib/core/node-views';

const BOY = 'a\u{1F466}b\n';

/** True when every surrogate in `text` has its partner. */
function isWellFormed(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const isHigh = code >= 0xd800 && code <= 0xdbff;
		const isLow = code >= 0xdc00 && code <= 0xdfff;
		if (isHigh && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
			i++;
			continue;
		}
		if (isHigh || isLow) return false;
	}
	return true;
}

// ── The belt's membership ────────────────────────────────────────────────────

/**
 * Every module naming the snap, and the cut it owes it to. Set equality, so sink N+1 is a
 * decision at birth: the prose count this census replaced was three sinks short.
 */
const BELT_MEMBERS: Record<string, string> = {
	'src/lib/core/lines.ts': 'the snap itself',
	'src/lib/selection/char-endpoint-snap.ts': 'the selection endpoint clamp',
	'src/lib/tree-operations/node-ops.ts':
		"the split's line-ending cut and the single-block range cut",
	'src/lib/tree-operations/paste/paste-replacement.ts':
		"the structural paste's before/after slices",
	'src/lib/tree-operations/list/list-builders.ts': "the absorb split's two item halves",
	'src/lib/components/blocks/text/live-selection-edit.ts':
		'the native ranged edit re-expressed as a join'
};

describe('the belt set', () => {
	it('exactly the declared modules name the snap', () => {
		const namers = collectEditorSources()
			.filter((file) => /(?<![\w.])snapToScalarBoundary\b/.test(file.code))
			.map((file) => file.relPath);
		expect(
			namers.sort(),
			'a module started (or stopped) snapping a caret offset: name the cut it owes the belt to'
		).toEqual(Object.keys(BELT_MEMBERS).sort());
	});
});

describe('snapToScalarBoundary', () => {
	it('moves an interior offset back to the pair start and leaves every other alone', () => {
		expect(snapToScalarBoundary(BOY, 2)).toBe(1);
		for (const offset of [0, 1, 3, 4]) expect(snapToScalarBoundary(BOY, offset)).toBe(offset);
	});

	it('is identity where no pair is involved', () => {
		expect(snapToScalarBoundary('plain\n', 3)).toBe(3);
		// A lone high surrogate already in the bytes is not a pair to protect.
		expect(snapToScalarBoundary('a\uD83Db', 2)).toBe(2);
	});
});

describe('the split cut', () => {
	it('splits beside the pair, never through it', () => {
		const doc = parse(BOY);
		splitNode(doc, 0, 2, createSharingState(), undefined, undefined);
		const out = serialize(doc);
		expect(isWellFormed(out)).toBe(true);
		expect(out).toBe('a\n\n\u{1F466}b\n');
	});
});

describe('the single-block range cut', () => {
	it('cuts to the pair boundary, leaving no half behind', () => {
		const node = parse(BOY).children[0] as NodeView;
		const cut = cutRangeFromDisplay(
			node,
			'a\u{1F466}b',
			{ start: 0, end: 2 },
			undefined,
			undefined
		);
		expect(isWellFormed(cut.display)).toBe(true);
		expect(cut.display).toBe('\u{1F466}b');
	});

	it('snaps the start endpoint too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const cut = cutRangeFromDisplay(
			node,
			'a\u{1F466}b',
			{ start: 2, end: 4 },
			undefined,
			undefined
		);
		expect(isWellFormed(cut.display)).toBe(true);
		expect(cut.display).toBe('a');
	});
});

describe('the structural paste’s before/after slices', () => {
	it('keeps the pair whole on one side of the pasted blocks', () => {
		const leaf = parse(BOY).children[0];
		const replacement = buildPastedReplacement(leaf, 2, parse('x\n').children);
		const raws = replacement.map((node: CstNode) => node.raw);
		expect(raws.every(isWellFormed)).toBe(true);
		expect(raws).toEqual(['a\n', 'x\n', '\u{1F466}b\n']);
	});
});

describe('the absorb split’s item halves', () => {
	it('keeps the pair whole on one half', () => {
		const leaf = parse(BOY).children[0];
		const { leadingNode, trailingNode } = splitLeafForPaste(leaf, 2);
		expect(isWellFormed(leadingNode!.raw)).toBe(true);
		expect(isWellFormed(trailingNode!.raw)).toBe(true);
		expect([leadingNode!.raw, trailingNode!.raw]).toEqual(['a\n', '\u{1F466}b\n']);
	});
});

describe('the native ranged edit’s join', () => {
	beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterEach(() => __resetLiveJoinSeamCleanerForTests());

	// The pair sits inside `**…**`, so the delete strands the marker runs and the seam cleaner
	// runs — the arm where a mid-pair endpoint reaches the slice.
	const SOURCE = 'Some **\u{1F466}bold** and *italic* words\n';

	it('snaps a mid-pair endpoint before slicing', () => {
		const node = parse(SOURCE, { scope: 'fragment' }).children[0] as NodeView;
		const edit = resolveSelectionEdit(node, { start: 8, end: 22 }, '', 'live', undefined);
		expect(edit).not.toBeNull();
		expect(isWellFormed(edit!.raw)).toBe(true);
	});
});

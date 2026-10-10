// @vitest-environment jsdom
// Every write that slices `raw` at a caret offset snaps to a scalar boundary first, or a gesture
// puts half a surrogate pair in each of two blocks.
// Miss-analysis: every offset these writes were driven with came from an ASCII fixture.
// Which modules may snap is G4.89's list, in `lint/file-rules.test.ts`.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { snapToScalarBoundary } from '#lib/core/lines.js';
import { splitNode } from '#lib/tree-operations/node-ops.js';
import { replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import { buildPastedReplacement } from '#lib/tree-operations/paste/paste-replacement.js';
import { splitLeafForPaste } from '#lib/tree-operations/list/list-builders.js';
import { fragmentReaderAt } from '#lib/tree-operations/list/task-paragraph.js';
import { cleanLiveJoinSeam } from '#lib/components/blocks/text/live-join-seam.js';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '#lib/schema/inline-construct-policy.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { NodeView } from '#lib/core/node-views.js';
import { fixtureReading, TOP_SLOT, topLevelStore } from '../harness/fixture-grammar';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

/** Both halves read as plain fragments, as they do outside a task item. */
const plainHalves = {
	leading: fragmentReaderAt(undefined, 0, defaultGrammarView),
	trailing: fragmentReaderAt(undefined, 0, defaultGrammarView)
};

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
		splitNode(doc, 0, 2, createSharingState(), fixtureReading());
		const out = serialize(doc);
		expect(isWellFormed(out)).toBe(true);
		expect(out).toBe('a\n\n\u{1F466}b\n');
	});
});

describe('the in-leaf range replace', () => {
	it('cuts to the pair boundary, leaving no half behind', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 0, end: 2 }, '', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('\u{1F466}b\n');
	});

	it('snaps the start endpoint too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 2, end: 4 }, '', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('a\n');
	});

	it('snaps a mid-pair endpoint where nothing is cleaned, too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 2, end: 3 }, 'x', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('axb\n');
	});
});

describe('the structural paste’s before/after slices', () => {
	it('keeps the pair whole on one side of the pasted blocks', () => {
		const leaf = parse(BOY).children[0];
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			2,
			parse('x\n').children,
			'\n',
			defaultGrammarView,
			TOP_SLOT
		);
		const raws = replacement.map((node: CstNode) => node.raw);
		expect(raws.every(isWellFormed)).toBe(true);
		expect(raws).toEqual(['a\n', 'x\n', '\u{1F466}b\n']);
	});
});

describe('the absorb split’s item halves', () => {
	it('keeps the pair whole on one half', () => {
		const leaf = parse(BOY).children[0];
		const { leadingNode, trailingNodes } = splitLeafForPaste(leaf, 2, '\n', undefined, plainHalves);
		expect(isWellFormed(leadingNode!.raw)).toBe(true);
		expect(isWellFormed(trailingNodes[0].raw)).toBe(true);
		expect([leadingNode!.raw, trailingNodes[0].raw]).toEqual(['a\n', '\u{1F466}b\n']);
	});
});

describe('the in-leaf range replace’s join', () => {
	beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterEach(() => __resetLiveJoinSeamCleanerForTests());

	// The pair sits inside `**…**`, so the delete strands the marker runs and the join cleanup
	// runs: the branch where a mid-pair endpoint reaches the slice.
	const SOURCE = 'Some **\u{1F466}bold** and *italic* words\n';

	it('snaps a mid-pair endpoint before slicing', () => {
		const node = parse(SOURCE, { scope: 'fragment' }).children[0] as NodeView;
		const store = topLevelStore(node, fixtureReading({}, 'live'));
		const edit = replaceRangeInLeaf(node, { start: 8, end: 22 }, '', store);
		expect(edit.matchesBrowserEdit).toBe(false);
		expect(isWellFormed(edit.raw)).toBe(true);
	});
});

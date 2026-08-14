// Miss-analysis: numbering had no cost pin at all — every case asserted the map, and a
// whole-document walk produces the same map as a per-subtree one, so only counting the
// inline parses tells them apart.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import {
	collectFootnoteReferences,
	footnoteNumbersFor
} from '$lib/plugins/footnotes/footnote-numbering';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import type { DocumentView } from '$lib/core/node-views';

const TOP_LEVEL = 40;

function referenceDenseDocument(): ReturnType<typeof parse> {
	const blocks: string[] = [];
	for (let i = 0; i < TOP_LEVEL; i++) blocks.push(`Paragraph ${i} with [^r${i}] inside.`);
	return parse(blocks.join('\n\n') + '\n');
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([footnotesPlugin()]);
});

describe('footnote numbering rebuilds one subtree per edit', () => {
	it('inline-parses only the edited subtree, not every top-level block', () => {
		const doc = referenceDenseDocument();
		footnoteNumbersFor(doc, 1);

		// Armed after the cold walk, so the count is the keystroke's alone.
		resetPerfInstruments();
		enablePerfInstruments();
		doc.children[3].raw = 'Paragraph 3 with [^r3] and [^extra] inside.';
		const numbers = footnoteNumbersFor(doc, 2);
		const parses = perfSnapshot().inlineComputeCount;
		disablePerfInstruments();

		expect(numbers.get('extra')).toBe(5);
		expect(numbers.get(`r${TOP_LEVEL - 1}`)).toBe(TOP_LEVEL + 1);
		expect(parses).toBe(1);
	});

	// sharing.ts copies only a node the epoch marked shared, and text-batch.ts snapshots once
	// per typing burst — so every keystroke after a batch's first rewrites the SAME object.
	// Keying the memo on node identity alone would freeze the numbering for the rest of the burst.
	it('renumbers a subtree rewritten in place, node identity unchanged', () => {
		const doc = parse('Body [^a].\n\nTail [^b].\n');
		const block = doc.children[0];
		expect([...footnoteNumbersFor(doc, 1).keys()]).toEqual(['a', 'b']);

		block.raw = 'Body [^z] and [^a].\n';
		expect(doc.children[0]).toBe(block);
		expect([...footnoteNumbersFor(doc, 2).keys()]).toEqual(['z', 'a', 'b']);
	});

	it('drops a label whose only reference the edit removed', () => {
		const doc = parse('Body [^a] and [^gone].\n\nTail [^b].\n');
		expect(footnoteNumbersFor(doc, 1).get('gone')).toBe(2);

		doc.children[0].raw = 'Body [^a].\n';
		const numbers = footnoteNumbersFor(doc, 2);
		expect(numbers.get('gone')).toBeUndefined();
		expect(numbers.get('b')).toBe(2);
	});

	// Both subtrees keep their own bytes, so both memo entries hit; only the concatenation
	// order moves. A map memoized on "no subtree changed" would hand back the old numbering.
	it('renumbers when a reorder moves a reference into an earlier slot', () => {
		const doc = parse('First [^a].\n\nSecond [^b].\n');
		expect(footnoteNumbersFor(doc, 1).get('a')).toBe(1);

		doc.children = [doc.children[1], doc.children[0]];
		const numbers = footnoteNumbersFor(doc, 2);
		expect(numbers.get('b')).toBe(1);
		expect(numbers.get('a')).toBe(2);
	});

	// The undo road: copy-path-on-write leaves the edited block a new node while the entry
	// keeps the original, and the restore publishes a fresh document over those shared nodes.
	it('replays the pre-edit numbering when undo restores the shared subtree', () => {
		const doc = parse('First [^a].\n\nSecond [^b].\n');
		const shared = [...doc.children];
		expect([...footnoteNumbersFor(doc, 1).keys()]).toEqual(['a', 'b']);

		const edited = { ...doc.children[0], raw: 'First [^a] and [^c].\n' };
		const afterEdit = { ...doc, children: [edited, doc.children[1]] } as DocumentView;
		expect([...footnoteNumbersFor(afterEdit, 2).keys()]).toEqual(['a', 'c', 'b']);

		const restored = { ...doc, children: [...shared] } as DocumentView;
		expect([...footnoteNumbersFor(restored, 3).keys()]).toEqual(['a', 'b']);
	});

	// Memoized paths are subtree-relative; the doc-absolute contract is the caller's rebase,
	// which must not compound when a second reader hits the same entry.
	it('rebases a memoized subtree path onto its top-level index, once', () => {
		const doc = parse('Zero.\n\n> A quote with [^q] inside.\n');
		const first = collectFootnoteReferences(doc);
		expect(first).toHaveLength(1);
		expect(first[0].path[0]).toBe(1);
		expect(first[0].path.length).toBeGreaterThan(1);
		expect(collectFootnoteReferences(doc)[0].path).toEqual(first[0].path);
	});
});

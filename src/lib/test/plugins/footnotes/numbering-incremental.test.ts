// Miss-analysis: every case asserted the map, which a whole-document pass also produces.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, type DocumentView } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { rebuildAncestryRaw } from '$lib/schema/container-raw';
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
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

const TOP_LEVEL = 40;

function referenceDenseDocument(): ReturnType<typeof parse> {
	const blocks: string[] = [];
	for (let i = 0; i < TOP_LEVEL; i++) blocks.push(`Paragraph ${i} with [^r${i}] inside.`);
	return parse(blocks.join('\n\n') + '\n');
}

beforeEach(() => {
	installPlugins([footnotesPlugin()]);
});

afterEach(() => {
	disablePerfInstruments();
});

describe('footnote numbering rebuilds one subtree per edit', () => {
	it('inline-parses only the edited subtree, not every top-level block', () => {
		const doc = referenceDenseDocument();
		footnoteNumbersFor(doc, 1);

		// Reset after the first pass, so the count is the keystroke's alone.
		resetPerfInstruments();
		enablePerfInstruments();
		doc.children[3].raw = 'Paragraph 3 with [^r3] and [^extra] inside.';
		const numbers = footnoteNumbersFor(doc, 2);
		const parses = perfSnapshot().inlineComputeCount;

		expect(numbers.get('extra')).toBe(5);
		expect(numbers.get(`r${TOP_LEVEL - 1}`)).toBe(TOP_LEVEL + 1);
		expect(parses).toBe(1);
	});

	// Copy-on-write copies only a shared node and typing snapshots once per burst, so later
	// keystrokes rewrite the same object; a cache keyed on node identity would freeze numbering.
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

	// Both subtrees keep their own bytes, so both cache entries hit; only the order changes.
	// A map cached on "no subtree changed" would hand back the pre-reorder numbering.
	it('renumbers when a reorder moves a reference into an earlier slot', () => {
		const doc = parse('First [^a].\n\nSecond [^b].\n');
		expect(footnoteNumbersFor(doc, 1).get('a')).toBe(1);

		doc.children = [doc.children[1], doc.children[0]];
		const numbers = footnoteNumbersFor(doc, 2);
		expect(numbers.get('b')).toBe(1);
		expect(numbers.get('a')).toBe(2);
	});

	// The undo path: copying down the path on write leaves the edited block a new node while
	// the entry keeps the original, and the restore writes a fresh document over those nodes.
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

	// Miss-analysis: every earlier case edited a top-level block, never one nested in a container.
	it('renumbers a nested edit once the ancestry rebuild moves the container raw', () => {
		const doc = parse('Head.\n\n> Quote [^q] here.\n');
		expect([...footnoteNumbersFor(doc, 1).keys()]).toEqual(['q']);

		const quote = doc.children[1];
		quote.children![0].raw = 'Quote [^q] here and [^nested] too.\n';
		rebuildAncestryRaw(quote, [0]);
		expect([...footnoteNumbersFor(doc, 2).keys()]).toEqual(['q', 'nested']);
	});

	// Miss-analysis: every case above passed the version as a literal, never the editor's own.
	it('recomputes after a real keystroke, against the editor’s own version', async () => {
		const harness = makeEditorActionsDeps(parse('Body [^a].\n\nTail [^b].\n'));
		const blockEdit = createBlockEditActions(harness.deps, createUndoController(harness.deps));
		const doc = harness.doc as DocumentView;
		expect([...footnoteNumbersFor(doc, harness.contentVersion()).keys()]).toEqual(['a', 'b']);

		await blockEdit.updateBlockContent(0, 'Body [^z] and [^a].\n', 'authored', 5, 9);
		expect([...footnoteNumbersFor(doc, harness.contentVersion()).keys()]).toEqual(['z', 'a', 'b']);
	});

	// Cached paths are relative to their subtree; making them document-absolute is the caller's
	// job, and it must not happen twice when a second caller hits the same entry.
	it('rebases a memoized subtree path onto its top-level index, once', () => {
		const doc = parse('Zero.\n\n> A quote with [^q] inside.\n');
		const first = collectFootnoteReferences(doc);
		expect(first).toHaveLength(1);
		expect(first[0].path[0]).toBe(1);
		expect(first[0].path.length).toBeGreaterThan(1);
		expect(collectFootnoteReferences(doc)[0].path).toEqual(first[0].path);
	});
});

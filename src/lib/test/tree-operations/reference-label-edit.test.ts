// @vitest-environment jsdom
// Miss-analysis: #809, no row edited a reference's text, so the shortcut and collapsed forms lost
// their destination the moment their text stopped matching the label.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import { replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import { spellReferenceLabels } from '#lib/core/inline/link-source-bytes.js';
import {
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';
import { collectEditorSources, LIBRARY_ROOTS } from '../invariants/lint/scan-source';

const DEFS = parse('[foo]: https://foo.example\n').children;

function readingFor(mode: PresentationMode, defs = DEFS) {
	const { resolve, signature } = definitionsOf(defs);
	return fixtureReading({ resolver: resolve, resolverSignature: signature }, mode);
}

function edit(
	source: string,
	start: number,
	end: number,
	typed: string,
	mode: PresentationMode = 'live'
) {
	const node = parse(source, { scope: 'fragment' }).children[0];
	return replaceRangeInLeaf(node, { start, end }, typed, topLevelStore(node, readingFor(mode))).raw;
}

describe('an edit of a reference’s text keeps its destination', () => {
	it.each([
		['a letter typed inside a shortcut', 'a [foo] b\n', 5, 5, 'Z', 'a [foZo][foo] b\n'],
		['a letter typed inside a collapsed one', 'a [foo][] b\n', 5, 5, 'Z', 'a [foZo][foo] b\n'],
		['a letter deleted inside a shortcut', 'a [foo] b\n', 4, 5, '', 'a [fo][foo] b\n'],
		['a selection inside typed over', 'a [foo] b\n', 4, 5, 'Z', 'a [fZo][foo] b\n'],
		['text typed over its start', 'a [foo] b\n', 3, 5, 'Z', 'a Z[o][foo] b\n'],
		['text typed over its end and past it', 'a [foo] b\n', 5, 8, 'Z', 'a [fo][foo]Zb\n']
	])('%s', (_, source, start, end, typed, written) => {
		expect(edit(source, start, end, typed)).toBe(written);
	});

	it('leaves a full reference as it is written', () => {
		expect(edit('a [foo][foo] b\n', 5, 5, 'Z')).toBe('a [foZo][foo] b\n');
	});

	it('removes the label with the link when the whole text is typed over', () => {
		expect(edit('a [foo] b\n', 3, 6, 'Z')).toBe('a Z b\n');
	});

	it('leaves source mode, which shows the brackets, byte-literal', () => {
		expect(edit('a [foo] b\n', 5, 5, 'Z', 'source')).toBe('a [foZo] b\n');
	});
});

describe('the reference walk a keystroke pays for', () => {
	beforeEach(() => {
		enablePerfInstruments();
		resetPerfInstruments();
	});

	it('walks no block in a document without definitions, or a block without a bracket', () => {
		const plain = parse('just words\n', { scope: 'fragment' }).children[0];
		spellReferenceLabels(plain, { start: 2, end: 2 }, readingFor('live'));
		spellReferenceLabels(plain, { start: 2, end: 2 }, readingFor('live', []));
		const linked = parse('a [foo] b\n', { scope: 'fragment' }).children[0];
		spellReferenceLabels(linked, { start: 5, end: 5 }, readingFor('live', []));
		expect(perfSnapshot().referenceWalks).toBe(0);
	});
});

// Every in-leaf edit goes through `replaceRangeInLeaf`, which spells the label; a route reaching
// it names the shape of edit it makes, so a new route is listed and its shape has a row.
type Shape =
	'typed at a caret' | 'a selection deleted' | 'a selection typed over' | 'a link rewritten whole';

const ROUTES: Record<string, Shape[]> = {
	'components/blocks/table/table-cell-paste.ts': ['a selection typed over'],
	'components/blocks/table/TableCellBlock.svelte': ['a selection deleted'],
	'components/blocks/text/edge-policy-dispatch.ts': [
		'a selection deleted',
		'a selection typed over'
	],
	'components/blocks/text/live-selection-edit.ts': [
		'a selection deleted',
		'a selection typed over'
	],
	'components/blocks/text/text-clipboard.ts': ['a selection deleted'],
	'components/blocks/text/TextEditableBlock.svelte': [
		'a selection deleted',
		'a selection typed over'
	],
	'components/blocks/text/widget-interaction.ts': ['a selection typed over'],
	'editor-actions/inline-range-commit.ts': ['a link rewritten whole'],
	'selection/selection-drop.ts': ['typed at a caret', 'a selection deleted'],
	'tree-operations/paste/dispatch.ts': ['a selection deleted'],
	'tree-operations/paste/hooks.ts': ['typed at a caret', 'a selection typed over']
};

const SHAPES: Record<Shape, [number, number, string, string]> = {
	'typed at a caret': [4, 4, 'Z', 'a [fZoo][foo] b\n'],
	'a selection deleted': [4, 5, '', 'a [fo][foo] b\n'],
	'a selection typed over': [4, 5, 'Z', 'a [fZo][foo] b\n'],
	'a link rewritten whole': [2, 7, '[new](u)', 'a [new](u) b\n']
};

describe('G4.280 every route into the in-leaf edit keeps a reference’s destination', () => {
	const callers = collectEditorSources(LIBRARY_ROOTS)
		.filter((file) => /\b(?:replaceRangeInLeaf|replaceDrawnRange)\s*\(/.test(file.code))
		.map((file) => file.relPath.replace(/^src\/lib\//, ''))
		.filter((file) => file !== 'tree-operations/leaf-range.ts');

	it('names every file that calls the in-leaf edit, with the shapes of edit it makes', () => {
		expect(callers.sort()).toEqual(Object.keys(ROUTES).sort());
	});

	it.each(Object.entries(SHAPES))('%s inside a shortcut reference', (_, row) => {
		const [start, end, typed, written] = row;
		expect(edit('a [foo] b\n', start, end, typed)).toBe(written);
	});
});

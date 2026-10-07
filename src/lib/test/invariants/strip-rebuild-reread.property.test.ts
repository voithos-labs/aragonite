// A quote or list item rebuild as shipped, keeping matched lines whole and in runs, against the
// same rebuild reading every previous line and keeping none whole: equal bytes, spans and rereads.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode } from '#lib/core/nodes.js';
import { metadataOf } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { firstDisplayLine, splitLines } from '#lib/core/lines.js';
import { quoteLines } from '#lib/core/parsers/blockquote.js';
import { listItemLines, readItemShape } from '#lib/core/parsers/list.js';
import type { LineCodec } from '#lib/core/strip-lines.js';
import { rebuildConcatRaw, rebuildStripRaw } from '#lib/schema/child-spans.js';
import { rebuildContainerRawIfContainer } from '#lib/schema/container-raw.js';
import { arbRespelledContainerDoc, freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(292929) } as const;

const LEAF_EDITS = [
	'typed',
	'lineAdded',
	'lineDropped',
	'blankAppended',
	'lineRepeated',
	'tabbed',
	'emptied',
	'childRemoved',
	'childRepeated'
] as const;
const ITEM_EDITS = ['markerFlipped', 'taskFlipped'] as const;
type Edit = (typeof LEAF_EDITS)[number] | (typeof ITEM_EDITS)[number];

/** The leaf's bytes after `edit`, which moves the lines the rebuild pairs by text. */
function editedLeaf(raw: string, edit: Edit): string {
	const lines = splitLines(raw);
	if (lines.length === 0) return raw;
	const first = lines[0];
	const ending = first.lineEnding || '\n';
	switch (edit) {
		case 'typed':
			return first.text + 'Z' + raw.slice(first.text.length);
		case 'lineAdded':
			return first.raw + 'added' + ending + raw.slice(first.raw.length);
		case 'lineDropped':
			return lines.length > 1 ? raw.slice(0, lines.at(-1)!.start) : raw;
		case 'blankAppended':
			return raw.endsWith('\n') ? raw + ending : raw;
		case 'lineRepeated':
			return first.text + ending + raw;
		case 'tabbed':
			return '\t' + raw;
		case 'emptied':
			return '';
		default:
			return raw;
	}
}

/** A whole child dropped or repeated beside its neighbours, which keep their bytes. */
function editSiblings(parent: CstNode, index: number, edit: Edit): void {
	const siblings = parent.children!;
	if (edit === 'childRemoved' && siblings.length > 1) siblings.splice(index, 1);
	if (edit === 'childRepeated') siblings.splice(index, 0, { ...siblings[index] });
}

function editItem(item: CstNode, edit: Edit): void {
	const meta = metadataOf(item, 'listItem');
	if (edit === 'markerFlipped' && /^[-*+]/.test(meta.marker ?? '- ')) {
		item.metadata = { ...meta, marker: (meta.marker ?? '- ').startsWith('-') ? '* ' : '- ' };
	}
	if (edit === 'taskFlipped') {
		const taskMarker = meta.taskMarker ? null : '[ ] ';
		item.metadata = { ...meta, taskMarker, taskItem: taskMarker !== null, taskChecked: false };
	}
}

function nodesOf(
	nodes: readonly CstNode[],
	parent: CstNode | null = null
): [CstNode, CstNode | null][] {
	return nodes.flatMap((node): [CstNode, CstNode | null][] => [
		[node, parent],
		...nodesOf(node.children ?? [], node)
	]);
}

function applyEdit(doc: { children: CstNode[] }, pick: number, edit: Edit): void {
	const all = nodesOf(doc.children);
	if ((ITEM_EDITS as readonly string[]).includes(edit)) {
		const items = all.filter(([node]) => node.kind === 'listItem');
		if (items.length > 0) editItem(items[pick % items.length][0], edit);
		return;
	}
	const leaves = all.filter(([node, parent]) => !node.children && parent);
	if (leaves.length === 0) return;
	const [leaf, parent] = leaves[pick % leaves.length];
	if (edit === 'childRemoved' || edit === 'childRepeated') {
		editSiblings(parent!, parent!.children!.indexOf(leaf), edit);
	} else {
		leaf.raw = editedLeaf(leaf.raw, edit);
	}
}

/** The line syntax read with no shortcut: every previous line is read, and none is a spelling. */
const readEveryLine = (codec: LineCodec): LineCodec => ({ ...codec, spells: () => false });

/** `rebuildListItemRaw` with every previous line read: the shipped rebuild's reference. */
function rebuildItemReadingEveryLine(item: CstNode): boolean {
	const meta = metadataOf(item, 'listItem');
	const before = readItemShape(firstDisplayLine(item.raw).text);
	const shape = {
		indent: before?.indent ?? '',
		marker: meta.marker ?? '- ',
		taskMarker: meta.taskMarker ?? null
	};
	const lines = listItemLines(shape);
	const previous = readEveryLine(before ? listItemLines(before) : lines);
	return rebuildStripRaw(item, lines, undefined, previous).rereads;
}

/** Every container rebuilt innermost first, as shipped or reading every line, and what each
 *  rebuild left: its bytes, its spans, and whether it asked for a reread. */
function rebuildAll(nodes: readonly CstNode[], readingEveryLine: boolean): unknown[] {
	return nodes.flatMap((node) => {
		if (!node.children) return [];
		const inner = rebuildAll(node.children, readingEveryLine);
		let rereads: boolean | undefined;
		if (!readingEveryLine) rereads = rebuildContainerRawIfContainer(node)?.rereads;
		else if (node.kind === 'blockquote') {
			rereads = rebuildStripRaw(node, quoteLines, undefined, readEveryLine(quoteLines)).rereads;
		} else if (node.kind === 'listItem') rereads = rebuildItemReadingEveryLine(node);
		else if (node.kind === 'list') rebuildConcatRaw(node);
		else rereads = rebuildContainerRawIfContainer(node)?.rereads;
		return [...inner, node.raw, Array.from(node.childSpans ?? []), rereads];
	});
}

type Round = { pick: number; edit: Edit }[];

/** Two rounds of edits, each rebuilt, so the second reads bytes the first rebuild wrote. */
function rebuildBoth(source: string, rounds: Round[]): void {
	const results = [false, true].map((readingEveryLine) => {
		const doc = parse(source);
		return rounds.map((round) => {
			for (const { pick, edit } of round) applyEdit(doc, pick, edit);
			const rebuilt = rebuildAll(doc.children, readingEveryLine);
			if (!readingEveryLine) expectItemsOpenAsTheirMetadata(doc.children);
			return rebuilt;
		});
	});
	expect(results[0]).toEqual(results[1]);
}

/** A list item whose text opens with a letter writes the marker and checkbox its metadata holds,
 *  whatever its previous bytes held. */
function expectItemsOpenAsTheirMetadata(nodes: readonly CstNode[]): void {
	for (const [node] of nodesOf(nodes)) {
		const opening = node.children?.[0];
		// The first child's separator lines sit on the item's opening line too.
		const text = opening ? opening.leadingTrivia + opening.raw : '';
		if (node.kind !== 'listItem' || !/^[a-z]/i.test(text)) continue;
		const meta = metadataOf(node, 'listItem');
		const shape = readItemShape(firstDisplayLine(node.raw).text);
		expect([shape?.marker, shape?.taskMarker]).toEqual([meta.marker, meta.taskMarker ?? null]);
	}
}

/** Shapes the respelled generator can't draw: a leaf with blank lines inside it, which an edit
 *  can leave at the end of the body, beside prose, lazy lines and nesting. */
const LEAFY_SOURCES = [
	'- a\n\n  ```\n  x\n\n  ```\n',
	'> ```\n> x\n>\n>\n> ```\n> tail\n',
	'- ```\n  a\n\n\n  b\n  ```\n\n  after\n  lazy\nmore\n',
	'> > a\n> > b\nlazy\n>\n> ```\n> c\n>\n> ```\n',
	'1. x\n\n       code\n\n       more\n\n   para\n',
	'- a\r\n\r\n  ```\r\n  b\r\n\r\n  ```\r\n',
	'* ---\n \t \r\n\n  \n',
	'> a\n>\n>  \n> b\n'
];

const arbRound = fc.array(
	fc.record({
		pick: fc.nat({ max: 20 }),
		edit: fc.constantFrom<Edit>(...LEAF_EDITS, ...ITEM_EDITS)
	}),
	{ maxLength: 3 }
);

describe('a strip rebuild keeps matched lines without reading them again', () => {
	it('writes what reading every previous line writes', () => {
		fc.assert(
			fc.property(
				fc.oneof(arbRespelledContainerDoc, fc.constantFrom(...LEAFY_SOURCES)),
				fc.array(arbRound, { minLength: 1, maxLength: 2 }),
				rebuildBoth
			),
			PARAMS
		);
	});

	// Shrunk counterexamples, pinned so they outlive a change to the generator.
	it.each([
		{
			name: 'a removed child between the kept runs, where both walks meet in one item',
			source: '1. x\n\n       code\n\n       more\n\n   para\n',
			rounds: [[{ pick: 4, edit: 'childRemoved' as const }]]
		},
		{
			name: 'blank paragraphs at the end of an item, the last one growing a line',
			source: '* ---\n \t \r\n\n  \n',
			rounds: [
				[
					{ pick: 20, edit: 'blankAppended' as const },
					{ pick: 10, edit: 'lineAdded' as const }
				]
			]
		},
		{
			// Miss-analysis: the marker check read the first child's raw alone, and 400 runs on the
			// fixed seed never drew an opening child with separator lines in front of it.
			name: 'an item whose first child goes, leaving the next one’s separator on its opening line',
			source: '* ---\n \t \r\n\n  \n',
			rounds: [[{ pick: 4, edit: 'typed' as const }], [{ pick: 0, edit: 'childRemoved' as const }]]
		}
	])('writes what reading every previous line writes: $name', ({ source, rounds }) => {
		rebuildBoth(source, rounds);
	});
});

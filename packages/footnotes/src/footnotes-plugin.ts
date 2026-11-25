/**
 * GFM footnotes: a `[^label]` reference drawn as its number, and a `[^label]:` definition whose
 * `[^label]` marker links back to the first reference. A number is the order its label is first
 * cited, worked out from the labels each top-level block cites, so no counter is stored anywhere.
 */

import {
	builtin,
	container,
	createScanIndex,
	definePlugin,
	inline,
	type Block,
	type Doc,
	type Editor,
	type Piece
} from '@voithos-labs/aragonite/plugin';
import { svelteBlock, svelteView } from '@voithos-labs/aragonite/svelte';
import DefinitionView from './FootnoteDefinition.svelte';
import ReferenceView from './FootnoteReference.svelte';
import { backToReferenceLabel } from './constants';
import { numbersOf } from './numbering';

/** A definition's data: the label its marker spells. */
export interface DefinitionData {
	label: string;
}

/** A reference: its label, and its bytes in the document, a jump back landing at `to`. */
export interface FootnoteReference {
	label: string;
	from: number;
	to: number;
}

// A label ends at `]` or at GFM's whitespace. The ends are found once per block, so a paragraph
// full of unclosed `[^` costs one scan instead of one per `[^`.
const LABEL_END = /[\] \t\n\v\f\r]/g;
const labelEndFrom = createScanIndex((text) =>
	Int32Array.from(text.matchAll(LABEL_END), (found) => found.index)
);

const reference = inline<string>({
	name: 'ref',
	label: 'Footnote reference',
	prefix: '[^',
	sample: ['[^note]', 'see [^a] and [^b]'],
	match(text, at, end) {
		const close = labelEndFrom(text, at + 2);
		return close === -1 || close >= end || close === at + 2 || text[close] !== ']' ? -1 : close + 1;
	},
	read: (claim) => claim.slice(2, -1),
	widget: { delete: 'select-first', arrows: 'into', click: 'follow' },
	depends: citedLabels,
	follow: jumpToDefinition,
	draw: svelteView(ReferenceView)
});

const definition = container<DefinitionData>({
	name: 'definition',
	label: 'Footnote',
	// Ahead of the link reference definition, which would read `[^1]: x` as one.
	before: builtin.blocks.linkReferenceDefinition,
	joins: false,
	merges: { key: 'label' },
	lines: {
		shape: 'indented',
		open: /^ {0,3}\[\^([^\] \t\n\v\f\r]+)\]: ?/,
		data: (match) => ({ label: match[1] }),
		first: (data) => `[^${data.label}]: `,
		rest: () => '    ',
		lazy: true,
		link: {
			length: (data) => data.label.length + 3,
			label: (data) => backToReferenceLabel(data.label),
			className: 'footnote-def-marker',
			follow: (data, editor) => jumpToFirstCitation(data.label, editor)
		}
	},
	sample: '[^1]: A footnote definition.\n    with an indented continuation.\n',
	insert: { none: 'a definition is typed below the text that cites it' },
	draw: svelteBlock(DefinitionView)
});

/** GFM footnotes: list `footnotes` in an editor's plugins. */
export const footnotes = definePlugin({
	name: 'footnotes',
	version: '0.11.5',
	editor: '0.11.5',
	contributes: () => ({ blocks: [definition], inlines: [reference] })
});

/** Every reference in `doc`, in document order. */
export function collectFootnoteReferences(doc: Doc): FootnoteReference[] {
	return [...referencesIn(doc.blocks)].map(({ data, from, to }) => ({ label: data, from, to }));
}

/** Each label's number in `doc`: the order it is first cited, as its references show it. */
export function assignFootnoteNumbers(doc: Doc): Map<string, number> {
	return numbersOf(doc.blocks.map(citedLabels));
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The labels a top-level block cites, in order, each followed by a space, which no label holds:
 *  what a reference's number is read from, asked again only of a block whose bytes changed. */
function citedLabels(block: Block): string {
	let labels = '';
	for (const { data } of referencesIn([block])) labels += `${data} `;
	return labels;
}

// Only a top-level block whose bytes hold `[^` can hold a footnote, so no other block is parsed.
function* footnoteBlocks(tops: Iterable<Block>): Generator<Block> {
	for (const top of tops) if (top.text.includes('[^')) yield* top.walk();
}

function* referencesIn(tops: Iterable<Block>): Generator<Piece<string>> {
	for (const block of footnoteBlocks(tops)) yield* referencePieces(block.pieces);
}

function* referencePieces(pieces: readonly Piece[]): Generator<Piece<string>> {
	for (const piece of pieces) {
		if (piece.is(reference)) yield piece;
		else yield* referencePieces(piece.children);
	}
}

function jumpToDefinition(label: string, editor: Editor): void {
	void jump(editor, (doc) => definitionStart(doc, label));
}

function jumpToFirstCitation(label: string, editor: Editor): void {
	void jump(editor, (doc) => firstCitationEnd(doc, label));
}

// `reveal` opens a closed section on the way, a write above the landing, so a moved document is
// read again. Reading mode opens none, and a reveal there leaves Tab on the block jumped from.
async function jump(editor: Editor, landing: (doc: Doc) => number | null): Promise<void> {
	const doc = editor.doc;
	const at = landing(doc);
	if (at === null) return;
	if (editor.mode.editable) await editor.view.reveal(at);
	const moved = doc.current ? at : landing(editor.doc);
	if (moved !== null) await editor.select(moved);
}

// Where a jump to a definition lands: the first under a label is the one GFM renders.
export function definitionStart(doc: Doc, label: string): number | null {
	for (const block of footnoteBlocks(doc.blocks)) {
		if (block.is(definition) && block.data.label === label)
			return block.children[0]?.from ?? block.from;
	}
	return null;
}

// The first citation gave the definition its number.
function firstCitationEnd(doc: Doc, label: string): number | null {
	for (const ref of referencesIn(doc.blocks)) if (ref.data === label) return ref.to;
	return null;
}

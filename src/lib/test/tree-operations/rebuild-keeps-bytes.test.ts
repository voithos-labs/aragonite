// A quote or list item rebuild keeps the bytes of every line its edit didn't touch, and the tree
// still reads back as itself.
// Miss-analysis: every container fixture was written in the rebuild's own spelling, so a rebuild
// that respelled the whole container wrote back the bytes it read and no test saw lines move.
import { beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { ListContext } from '#lib/action-contracts.js';
import { displayLength, documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { buildQuoteExitReplacement, plainQuote } from '#lib/tree-operations/blockquote.js';
import { liftFirstChild } from '#lib/tree-operations/container-lift.js';
import { buildExitReplacement } from '#lib/tree-operations/list/exit-replacement.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeContainerHarness,
	makeEditorActionsDeps,
	makeListContextAt,
	makeTopHarness
} from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

type Bundle = ReturnType<typeof makeContainerHarness>['bundle'];

type Gesture =
	| { type: [leaf: number[], at: number, text: string] }
	| { in: number[]; edit: (bundle: Bundle, container: CstNode) => Promise<unknown> };

/** The display length of the container's child at `index`: Enter there splits at its end. */
const endOf = (container: CstNode, index: number): number =>
	displayLength(container.children![index].raw);

interface Row {
	name: string;
	source: string;
	gesture: Gesture;
	after: string;
}

/** `text` typed into the leaf at `leaf` at display offset `offset` (-1 for its end), through the
 *  keystroke's route. */
async function typeInPlace(source: string, leaf: number[], offset: number, text: string) {
	const h = makeTopHarness(source);
	const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
	const raw = owner.children![leaf[leaf.length - 1]].raw;
	const at = offset < 0 ? displayLength(raw) : offset;
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
	const write = legalizeWrite(
		body,
		leaf[leaf.length - 1],
		raw.slice(0, at) + text + raw.slice(at),
		'authored'
	);
	const typing = createLeafTyping(h.deps, h.controller);
	expect(typing.writeLeafInPlace(docPathFrom(leaf), write, at).wrote).toBe(true);
	return h.deps.doc;
}

async function run(source: string, gesture: Gesture): Promise<Document> {
	if ('type' in gesture) return typeInPlace(source, ...gesture.type);
	const h = makeContainerHarness(source, gesture.in);
	await gesture.edit(h.bundle, h.getNode());
	return h.deps.doc;
}

const ROWS: Row[] = [
	// Typing
	{
		name: 'an indented list keeps its indent, and the item below stays a sibling',
		source: '  - a\n  - b\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '  - aQ\n  - b\n'
	},
	{
		name: 'a tab-indented continuation keeps its tab',
		source: '- a\n\tb\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '- aQ\n\tb\n'
	},
	{
		name: 'a lazy line in an item keeps no indent',
		source: '- a\nlazy\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '- aQ\nlazy\n'
	},
	{
		name: 'an indented separator in an item keeps its spaces',
		source: '- a\n  \n  b\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '- aQ\n  \n  b\n'
	},
	{
		name: 'a sibling child spelled with a tab keeps it',
		source: '- a\n\n  b\n\n\tc\n',
		gesture: { type: [[0, 0, 1], 1, 'Q'] },
		after: '- a\n\n  bQ\n\n\tc\n'
	},
	{
		name: 'a quote sibling with no space after its marker keeps it',
		source: '> a\n>\n>b\n',
		gesture: { type: [[0, 0], 1, 'Q'] },
		after: '> aQ\n>\n>b\n'
	},
	{
		name: 'a quote separator with a trailing space keeps it',
		source: '> a\n> \n> b\n',
		gesture: { type: [[0, 0], 1, 'Q'] },
		after: '> aQ\n> \n> b\n'
	},
	{
		name: 'an indented quote keeps its indent',
		source: '  > a\n',
		gesture: { type: [[0, 0], 1, 'Q'] },
		after: '  > aQ\n'
	},
	{
		name: 'a nested quote written with no space between markers keeps it',
		source: '>> a\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '>> aQ\n'
	},
	{
		name: 'a lazy line two quotes deep keeps its bytes',
		source: '> > a\n>b\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '> > aQ\n>b\n'
	},
	// Miss-analysis: every typed quote row had a space after its marker, so a rule respelling the
	// line typed on after a bare `>` passed them all.
	{
		name: 'a line typed on after a bare marker keeps it',
		source: '>a\n',
		gesture: { type: [[0, 0], 1, 'Q'] },
		after: '>aQ\n'
	},
	{
		name: 'an indented bare marker keeps its indent',
		source: '  >a\n',
		gesture: { type: [[0, 0], 1, 'Q'] },
		after: '  >aQ\n'
	},
	{
		name: 'a nested quote of bare markers keeps them',
		source: '>>a\n',
		gesture: { type: [[0, 0, 0], 1, 'Q'] },
		after: '>>aQ\n'
	},
	{
		name: 'a lazy-continued line behind a bare marker keeps it',
		source: '> > a\n>b\n',
		gesture: { type: [[0, 0, 0], -1, 'Q'] },
		after: '> > a\n>bQ\n'
	},
	{
		name: 'a bare marker inside a list item keeps it',
		source: '- >a\n',
		gesture: { type: [[0, 0, 0, 0], 1, 'Q'] },
		after: '- >aQ\n'
	},
	{
		name: 'an empty quote line gaining text takes the marker’s space',
		source: '>\n',
		gesture: { type: [[0, 0], 0, 'a'] },
		after: '> a\n'
	},
	// Enter, Backspace, delete
	{
		name: 'Enter in a quote keeps the lines either side of the new one',
		source: '>a\n>\n>b\n',
		gesture: { in: [0], edit: (b) => b.blockEdit.splitBlock(0, 1) },
		after: '>a\n>\n>\n>b\n'
	},
	{
		name: 'Enter in a list item keeps its tab-indented lines',
		source: '- a\n\tb\n\n\tc\n',
		gesture: { in: [0, 0], edit: (b, item) => b.blockEdit.splitBlock(0, endOf(item, 0)) },
		after: '- a\n\tb\n\n\n\tc\n'
	},
	{
		name: 'deleting a quote’s middle block keeps the survivors’ bytes',
		source: '>a\n>\n>b\n>\n>c\n',
		gesture: { in: [0], edit: (b) => b.blockEdit.deleteBlock(1, 'keyless') },
		after: '>a\n>\n>c\n'
	},
	{
		name: 'Backspace joining two quote paragraphs keeps the lines below',
		source: '> a\n>\n> b\n>\n>\tc\n',
		gesture: { in: [0], edit: (b) => b.blockEdit.mergeWithPrevious(1) },
		after: '> ab\n>\n>\tc\n'
	},
	{
		name: 'Backspace joining two item paragraphs keeps the lines below',
		source: '- a\n\n  b\n\n\tc\n',
		gesture: { in: [0, 0], edit: (b) => b.blockEdit.mergeWithPrevious(1) },
		after: '- ab\n\n\tc\n'
	}
];

const toCrlf = (bytes: string): string => bytes.replace(/\n/g, '\r\n');

describe('an edit inside a quote or list item keeps its untouched lines', () => {
	for (const ending of ['LF', 'CRLF'] as const) {
		const mirror = ending === 'LF' ? (bytes: string) => bytes : toCrlf;
		it.each(ROWS)(`$name, ${ending}`, async ({ source, gesture, after }) => {
			const doc = await run(mirror(source), gesture);
			expect(serialize(doc)).toBe(mirror(after));
			expect(describeConvergence(doc)).toBeNull();
		});
	}
});

// Miss-analysis: the press wrote nothing and a rule respelled the line's next rewrite, so no test
// held the press to a write of its own.
describe('the space that finishes a bare `>`', () => {
	it('is written into the quote’s line as one undo entry, and the next key lands after it', async () => {
		const h = makeContainerHarness('>abcdef\n', [0]);

		expect(await h.bundle.blockEdit.completeMarker(0)).toBe(true);
		expect(serialize(h.deps.doc)).toBe('> abcdef\n');
		expect(h.deps.undoManager.getStacks().undo).toHaveLength(1);

		const owner = h.deps.doc.children[0];
		const body = { children: owner.children!, owner, lineEnding: '\n' as const };
		const write = legalizeWrite(body, 0, 'Qabcdef\n', 'authored');
		createLeafTyping(h.deps, h.controller).writeLeafInPlace(docPathFrom([0, 0]), write, 1);
		expect(serialize(h.deps.doc)).toBe('> Qabcdef\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});
});

describe('a container built from another keeps its source’s bytes', () => {
	beforeEach(() => installPlugins([admonitionsPlugin()]));

	it('a quote exit keeps the lines it leaves', () => {
		const quote = parse('>a\n>\n>b\n>\n>\n').children[0];
		const [trimmed] = buildQuoteExitReplacement(quote, defaultGrammarView);
		expect(trimmed.raw).toBe('>a\n>\n>b\n');
	});

	it('the quote an alert leaves after a lift keeps its lines', () => {
		const alert = parse('>[!NOTE]\n>a\n>\n>b\n').children[0];
		expect(alert.kind).toBe('githubAlert');
		const [, rest] = liftFirstChild(alert, plainQuote(defaultGrammarView));
		expect(rest.raw).toBe('>b\n');
	});

	it('the item Enter splits off keeps the lines it took', async () => {
		const { deps } = makeEditorActionsDeps(parse('- ab\n\n\tc\n').children);
		const liveItem = () => deps.doc.children[0].children![0];
		registerBlockListState(liveItem(), makeBlockListState(liveItem));
		const { listContext } = makeListContextAt(deps, 0);

		await listContext.splitItemAtOffset(0, 0, 1);

		expect(serialize(deps.doc)).toBe('- a\n- b\n\n\tc\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});

	// Miss-analysis: every Enter row split a list at column zero, so a new item made with no
	// indent beside indented siblings looked right, while a reload nested the next item under it.
	it.each([
		['after an item', (c: ListContext) => c.insertItemAfter(0)],
		['by splitting an item at its end', (c: ListContext) => c.splitItemAtOffset(0, 0, 1)]
	])('a new item made %s takes its siblings’ indent', async (_name, enter) => {
		const { deps } = makeEditorActionsDeps(parse('  - a\n  - b\n').children);
		const liveItem = () => deps.doc.children[0].children![0];
		registerBlockListState(liveItem(), makeBlockListState(liveItem));
		const { listContext } = makeListContextAt(deps, 0);

		await enter(listContext);

		expect(serialize(deps.doc)).toBe('  - a\n  - \n  - b\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});

	it('a list exit keeps the items it leaves', () => {
		const list = parse('- a\n\tb\n- \n- c\n').children[0];
		const { blocks } = buildExitReplacement(list, 1, '\n');
		expect([blocks[0].raw, blocks.at(-1)!.raw]).toEqual(['- a\n\tb\n', '- c\n']);
	});
});

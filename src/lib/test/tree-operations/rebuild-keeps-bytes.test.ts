// A quote or list item rebuild keeps the bytes of every line its edit didn't touch, and the tree
// still reads back as itself.
// Miss-analysis: every container fixture was written in the rebuild's own spelling, so a rebuild
// that respelled the whole container wrote back the bytes it read and no test saw lines move.
import { beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, Document } from '$lib/core/nodes';
import { displayLength, documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { buildQuoteExitReplacement, plainQuote } from '$lib/tree-operations/blockquote';
import { liftFirstChild } from '$lib/tree-operations/container-lift';
import { buildExitReplacement } from '$lib/tree-operations/list/exit-replacement';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { makeContainerHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

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

/** `text` typed into the leaf at `leaf` at display offset `at`, through the keystroke's route. */
async function typeInPlace(source: string, leaf: number[], at: number, text: string) {
	const h = makeTopHarness(source);
	const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
	const raw = owner.children![leaf[leaf.length - 1]].raw;
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
	{
		name: 'a line typed after a marker with no space takes the space',
		source: '>abcdef\n',
		gesture: { type: [[0, 0], 0, 'Q'] },
		after: '> Qabcdef\n'
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

	it('a list exit keeps the items it leaves', () => {
		const list = parse('- a\n\tb\n- \n- c\n').children[0];
		const { blocks } = buildExitReplacement(list, 1, '\n');
		expect([blocks[0].raw, blocks.at(-1)!.raw]).toEqual(['- a\n\tb\n', '- c\n']);
	});
});

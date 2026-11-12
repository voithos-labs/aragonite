// G1.55: a written block whose bytes read back as another tree fails the check, the keystroke and
// the commit both run it on the blocks they name, looking inside no other, and a block past its
// size bound costs it nothing; a byte splice's window read with its neighbours fails the same way.
// Miss-analysis: the in-place keystroke ran no read-back check at all, and the commit compares
// bytes, which a list whose second item a reload nests under the first still passes.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { NodeView } from '#lib/core/node-views.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import {
	checkReadsBack,
	checkRunReadsBack,
	spliceRuns,
	READ_BACK_LIMIT,
	takeReadBackBytes
} from '#lib/invariants/reads-back.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { makeContainerHarness, makeTopHarness } from '../harness/editor-actions';

function typeAtEnd(source: string, leaf: number[], text: string) {
	const h = makeTopHarness(source);
	typeInto(h, leaf, text);
	return h.deps.doc;
}

/** `text` typed at the end of the leaf at `leaf`'s first line, through the keystroke's route. */
function typeInto(h: ReturnType<typeof makeTopHarness>, leaf: number[], text: string): void {
	const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
	const raw = owner.children![leaf[leaf.length - 1]].raw;
	const at = raw.search(/\r?\n|$/);
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
	const write = legalizeWrite(
		body,
		leaf[leaf.length - 1],
		raw.slice(0, at) + text + raw.slice(at),
		'authored',
		defaultGrammarView
	);
	h.controller.typeLeaf(docPathFrom(leaf), write, at + 1);
}

/** Counts every read of a top-level container's children, except the one at `skip`, and except
 *  the undo digest's (G1.9) and the last-line check's (G1.41), which read past the edit by design. */
function countChildReads(doc: Document, skip: number): () => number {
	let reads = 0;
	const count = () => {
		const stack = new Error().stack ?? '';
		if (!stack.includes('digestDoc') && !stack.includes('checkLastLineKept')) reads++;
	};
	doc.children.forEach((top, i) => {
		if (i === skip || top.children === undefined) return;
		let children = top.children;
		Object.defineProperty(top, 'children', {
			get: () => (count(), children),
			set: (next) => (children = next),
			enumerable: true,
			configurable: true
		});
	});
	return () => reads;
}

beforeEach(() => {
	takeReadBackBytes();
});

describe('G1.55 checkReadsBack', () => {
	it('fails an indented list whose rebuild dropped the indent, which nests its second item', () => {
		const list = parse('  - a\n  - b\n').children[0];
		const item = list.children![0];
		item.children![0].raw = 'aQ\n';
		item.raw = '- aQ\n';
		list.raw = '- aQ\n  - b\n';

		expect(checkReadsBack(list, defaultGrammarView)?.message).toMatch(
			/live has 2 children, reparsed has 1/
		);
	});

	it('fails a list whose rebuild left it no bytes while it still holds an item', () => {
		const list = parse('- a').children[0];
		const item = list.children![0];
		item.children![0].raw = '';
		item.raw = '';
		list.raw = '';

		expect(checkReadsBack(list, defaultGrammarView)?.message).toMatch(
			/live has 1 children, reparsed has 0/
		);
	});

	it('fails a top-level paragraph whose bytes read as a heading', () => {
		const paragraph = parse('a\n').children[0];
		paragraph.raw = '# a\n';

		expect(checkReadsBack(paragraph, defaultGrammarView)?.message).toMatch(
			/live kind "paragraph" != reparsed "heading"/
		);
	});

	it.each(['- ', '- [ ] ', '>', '> - '])(
		'passes %j, which the editor reads with an empty paragraph to type in',
		(source) => {
			const top = initDocument(source, defaultGrammarView).doc.children[0];

			expect(checkReadsBack(top, defaultGrammarView)).toBeNull();
		}
	);

	it('passes the list a keystroke in the same item leaves', () => {
		const doc = typeAtEnd('  - a\n  - b\n', [0, 0, 0], 'Q');

		expect(checkReadsBack(doc.children[0], defaultGrammarView)).toBeNull();
	});
});

describe('G1.55 runs on the keystroke and the commit, bounded by size', () => {
	it('reads the container a keystroke rebuilt', () => {
		const doc = typeAtEnd('> a\n>\n> b\n', [0, 0], 'Q');

		expect(takeReadBackBytes()).toBe(doc.children[0].raw.length);
	});

	it('reads the container a commit rebuilt', async () => {
		const h = makeContainerHarness('intro\n\n> a\n>\n> b\n', [1]);

		await h.bundle.blockEdit.splitBlock(0, 1);

		expect(takeReadBackBytes()).toBe(h.deps.doc.children[1].raw.length);
	});

	it('reads the top-level leaf a commit wrote', async () => {
		const h = makeTopHarness('intro\n\nnext\n');

		await h.actions.updateBlockContent(0, '# intro\n', 'authored', 'join-typing', 0, 2);

		expect(h.deps.doc.children[0].kind).toBe('heading');
		expect(takeReadBackBytes()).toBe(h.deps.doc.children[0].raw.length);
	});

	it('reads the new container when a commit changes the kind of the one it wrote in', async () => {
		installPlugins([admonitionsPlugin()]);
		const h = makeContainerHarness('> x\n', [0]);

		await h.bundle.blockEdit.updateBlockContent(
			0,
			'[!TIP]\n\nbody\n',
			'authored',
			'join-typing',
			1,
			13
		);

		expect(h.deps.doc.children[0].kind).toBe('githubAlert');
		expect(takeReadBackBytes()).toBe(h.deps.doc.children[0].raw.length);
	});

	it('looks inside no container but the one a keystroke rebuilt', () => {
		const h = makeTopHarness(Array.from({ length: 400 }, (_, i) => `> q${i}\n`).join('\n'));
		const reads = countChildReads(h.deps.doc, 200);

		typeInto(h, [200, 0], 'Q');

		expect(h.deps.doc.children[200].raw).toBe('> q200Q\n');
		expect(reads()).toBe(0);
	});

	it('looks inside no container but the one a commit rebuilt', async () => {
		// A paragraph last, since the last-line check (G1.41) reads the document's last block.
		const quotes = Array.from({ length: 400 }, (_, i) => `> q${i}\n>\n> r${i}\n`).join('\n');
		const h = makeContainerHarness(`${quotes}\ntail\n`, [200]);
		const reads = countChildReads(h.deps.doc, 200);

		await h.bundle.blockEdit.splitBlock(0, 1);

		expect(h.deps.doc.children[200].raw).toBe('> q\n>\n> 200\n>\n> r200\n');
		expect(reads()).toBe(0);
	});

	it('reads nothing of a container past the bound', () => {
		const source = Array.from({ length: 2500 }, (_, i) => `> line ${i}\n>\n`).join('');
		expect(source.length).toBeGreaterThan(READ_BACK_LIMIT);

		typeAtEnd(source, [0, 1250], 'Q');

		expect(takeReadBackBytes()).toBe(0);
	});
});

describe('G1.55 over a run of blocks', () => {
	it('fails a run whose blocks read as fewer together, and passes one that reads as itself', () => {
		const apart = parse('```\nx\n\ny\n').children;
		// An unclosed fence takes in the paragraph a window that stopped short left beside it.
		const cut: CstNode[] = [
			{ ...apart[0], raw: '```\nx\n' },
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'y\n' }
		];
		expect(checkRunReadsBack(cut, defaultGrammarView)?.code).toBe('reads-back');
		expect(checkRunReadsBack(parse('a\n\n# b\n').children, defaultGrammarView)).toBeNull();
	});

	// Miss-analysis: a window holding an opener far from its closer was read with its neighbours alone.
	it('reads a window holding a waiting opener, or a line that may close one, to the far end', () => {
		installPlugins([admonitionsPlugin()]);
		const spans = (top: readonly NodeView[], at: number) =>
			spliceRuns(top, [{ at, count: 1 }], defaultGrammarView).map((run) => [
				top.indexOf(run[0]),
				run.length
			]);
		const waiting = parse(':::note\na\n\nb\n\nc\n\nd\n').children;
		expect(spans(waiting, 0)).toEqual([[0, 4]]);
		expect(spans(waiting, 2)).toEqual([[1, 3]]);
		expect(spans(parse('a\n\nb\n\nc\n\n:::\n').children, 3)).toEqual([[0, 4]]);
	});

	// Miss-analysis: the run was the splice's own window and a block either side, so a window that
	// started or stopped short of a definition waiting on its title read back as itself.
	it('reads a window flush against its neighbours out to the blank lines, where a short one shows', () => {
		// What a window starting at `end` leaves: the definition four blocks up took no title.
		const started = [...parse('[a]: /u\n    "code\n[b]: /v\n[b]: /v\nend\n\nlast\n').children];
		started[4] = { ...started[4], raw: 'end"\n' };
		const [late] = spliceRuns(started, [{ at: 4, count: 1 }], defaultGrammarView);
		expect(late[0]).toBe(started[0]);
		expect(checkRunReadsBack(late, defaultGrammarView)?.code).toBe('reads-back');
		// What a window stopping at `text` leaves once the heading is gone: the title closes below it.
		const stopped = parse("[a]: /u\n    'code\n# h\ntext\nend'\n\nlast\n").children.filter(
			(block) => block.kind !== 'heading'
		);
		const [short] = spliceRuns(stopped, [{ at: 2, count: 0 }], defaultGrammarView);
		expect(checkRunReadsBack(short, defaultGrammarView)?.code).toBe('reads-back');
	});

	it('stops a run at the blank lines, and keeps to the neighbours where it would pass the limit', () => {
		const spans = (top: readonly NodeView[], at: number) =>
			spliceRuns(top, [{ at, count: 1 }], defaultGrammarView).map((run) => [
				top.indexOf(run[0]),
				run.length
			]);
		expect(spans(parse('a\n\n# b\n# c\n# d\n\ne\n').children, 3)).toEqual([[1, 4]]);
		expect(spans(parse('a\n\n# b\n\n# c\n\n# d\n').children, 2)).toEqual([[1, 3]]);
		const long = parse('# heading\n'.repeat(READ_BACK_LIMIT / 5)).children;
		expect(spans(long, 100)).toEqual([[99, 3]]);
	});
});

// G1.55: a rebuilt container whose bytes read back as another tree fails the check, the keystroke
// and the commit both run it on the containers they name, looking inside no other, and a container
// past its size bound costs it nothing.
// Miss-analysis: the in-place keystroke ran no read-back check at all, and the commit compares
// bytes, which a list whose second item a reload nests under the first still passes.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { checkReadsBack, READ_BACK_LIMIT, takeReadBackBytes } from '#lib/invariants/reads-back.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
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
		'authored'
	);
	createLeafTyping(h.deps, h.controller).writeLeafInPlace(docPathFrom(leaf), write, at + 1);
}

/** Counts every read of a top-level container's children, except the one at `skip`. The undo
 *  digest (G1.9) walks every node of a commit's snapshot by design, so its reads don't count. */
function countChildReads(doc: Document, skip: number): () => number {
	let reads = 0;
	const count = () => {
		if (!new Error().stack?.includes('digestDoc')) reads++;
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

	it('reads the new container when a commit changes the kind of the one it wrote in', async () => {
		installPlugins([admonitionsPlugin()]);
		const h = makeContainerHarness('> x\n', [0]);

		await h.bundle.blockEdit.updateBlockContent(0, '[!TIP]\n\nbody\n', 'authored', 1, 13);

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

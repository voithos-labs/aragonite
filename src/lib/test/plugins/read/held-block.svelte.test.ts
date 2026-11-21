// @vitest-environment jsdom
// A block a plugin holds across writes finds its node again without walking the document: through
// the runs each write reports, answering only where its node stands, and -1 anywhere else.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { DocumentView } from '#lib/core/node-views.js';
import { parse } from '#lib/core/parser.js';
import { grammar } from '#lib/components/editor-root/headless-grammar.js';
import { checkHeldBlockPlace } from '#lib/invariants/held-block.js';
import { makeNode, makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { createDocumentRead } from '#lib/editor-actions/commit/document-read.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { serialize } from '#lib/core/serializer.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const DOC = 'intro\n\n- ant\n- bee\n\npara one\n\npara two\n';

async function mounted(source: string, plugins: readonly unknown[] = []) {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader, ...(plugins as [])] });
	await m.settle();
	return { editor: editor!, m };
}

async function typeAt(m: MountedEditor, path: number[], text: string): Promise<void> {
	typeInto(surfaceAt(m, path), text);
	await m.settle();
}

/** The bytes a held block reads in the document as it stands, or `left`. */
const held = (m: MountedEditor, block: Block) =>
	block.from < 0 ? 'left' : m.source().slice(block.from, block.to);

describe('a held block', () => {
	it('follows an Enter typed in a block above it', async () => {
		const { editor, m } = await mounted(DOC);
		const two = editor.blockAt(DOC.indexOf('para two'))!;
		await pressKeyAt(m, [0], 'intro'.length, { key: 'Enter' });
		expect(m.source()).not.toBe(DOC);
		expect(held(m, two)).toBe('para two\n');
	});

	// Miss-analysis: every held-block row wrote with `editor.edit()`, which keeps the nodes it
	// leaves alone, never with the key route that copies the block a run first types in.
	it('reads -1 once a key typed in it replaces its node, and again after an undo', async () => {
		const { editor, m } = await mounted(DOC);
		const one = editor.blockAt(DOC.indexOf('para one'))!;
		await typeAt(m, [2], 'para oneX');
		expect([one.from, one.to, one.offsetAt(DOC.indexOf('one')), one.parent]).toEqual([
			-1,
			-1,
			null,
			null
		]);
		expect(held(m, editor.blockAt(m.source().indexOf('oneX'))!)).toBe('para oneX\n');
		editor.run('history.undo');
		await m.settle();
		expect([m.source(), held(m, one)]).toEqual([DOC, 'para one\n']);
	});

	it('reads -1, never a neighbour, once a sibling is put in above it in its container', async () => {
		const { editor, m } = await mounted(DOC);
		const bee = editor.blockAt(DOC.indexOf('bee'))!;
		await pressKeyAt(m, [1, 0, 0], 'ant'.length, { key: 'Enter' });
		expect(m.source()).toBe(DOC.replace('- ant\n', '- ant\n- \n'));
		expect([bee.from, bee.index]).toEqual([-1, -1]);
	});

	// Miss-analysis: a block was read fresh on every `blockAt`, so no row held one's pieces across
	// a write that moved them.
	it('places its pieces where they stand after a key above it', async () => {
		const { editor, m } = await mounted('intro\n\nsee `code` here\n');
		const held = editor.blockAt(9)!;
		void held.pieces;
		await typeAt(m, [0], 'introX');
		const code = held.pieces.find((piece) => piece.kind === 'inlineCode')!;
		expect(m.source().slice(code.from, code.to)).toBe('`code`');
	});

	it('keeps its place through a key in another item of its container', async () => {
		const { editor, m } = await mounted(DOC);
		const bee = editor.blockAt(DOC.indexOf('bee'))!;
		await typeAt(m, [1, 0, 0], 'antX');
		expect([held(m, bee), bee.index, bee.parent!.index]).toEqual(['bee\n', 0, 1]);
	});
});

/** What a plugin reading blocks on every edit costs over a run of keys near the top of `n`
 *  blocks: the block at the caret, a block by index, and one held from before the keys. */
async function readingCost(n: number) {
	const source = Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');
	const seen: number[] = [];
	const follower = definePluginUnit({
		name: 'follower',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup: (editor) =>
				editor.on('edit', () => {
					const doc = editor.doc;
					seen.push(doc.blockAt(doc.text.indexOf('line 2'))!.from, doc.blocks[n - 3].from);
				})
		})
	});
	const { editor, m } = await mounted(source, [follower]);
	const last = editor.blockAt(source.length - 2)!;
	resetPerfInstruments();
	enablePerfInstruments();
	await pressKeyAt(m, [1], 0, { key: 'Enter' });
	await typeAt(m, [2], 'x line 1');
	await typeAt(m, [2], 'xy line 1');
	expect(held(m, last)).toBe(`line ${n - 1}\n`);
	expect(seen.length).toBeGreaterThan(4);
	expect(seen).not.toContain(-1);
	const { documentWalks, blocksBuilt, topBlocksMeasured } = perfSnapshot();
	await m.destroy();
	return { documentWalks, blocksBuilt, topBlocksMeasured };
}

describe('G4.368 reading a block walks nothing, at 400 blocks as at 2,000', () => {
	// Miss-analysis: no row counted what a read cost; a held block found its node by walking the
	// whole document whenever a write had moved it.
	it('asks no walk, and builds and measures as many blocks at either size', async () => {
		const small = await readingCost(400);
		expect(small.documentWalks).toBe(0);
		expect(await readingCost(2000)).toEqual(small);
	});

	it('builds no block of a list nobody reads past its length', () => {
		const list = Array.from({ length: 25_000 }, (_, i) => `- item ${i}\n`).join('');
		const doc = grammar([]).parse(list);
		resetPerfInstruments();
		enablePerfInstruments();
		expect(doc.blocks[0].children.length).toBe(25_000);
		expect(doc.blocks[0].children[24_999].children[0].text).toBe('item 24999\n');
		expect(perfSnapshot().blocksBuilt).toBe(3);
	});
});

describe('a key no plugin reads', () => {
	// Miss-analysis: a new cost; the read kept nothing across writes before.
	it('logs no runs and builds no block, until a plugin holds one', async () => {
		const { editor, m } = await mounted(DOC);
		resetPerfInstruments();
		enablePerfInstruments();
		await typeAt(m, [2], 'para oneX');
		expect(perfSnapshot()).toMatchObject({ hintRunsLogged: 0, blocksBuilt: 0, documentWalks: 0 });
		void editor.blockAt(0);
		await typeAt(m, [2], 'para oneXY');
		expect(perfSnapshot()).toMatchObject({ hintRunsLogged: 1, blocksBuilt: 1, documentWalks: 0 });
	});
});

describe('a held block, through a write whose runs went unread', () => {
	// Miss-analysis: every held-block row read a position first, so the record was measured and
	// each write said what it changed; with nothing measured a write says nothing.
	it('keeps its place where its node still stands', async () => {
		const h = makeTopHarness('zero\n\none\n\ntwo\n');
		const read = createDocumentRead({
			getDoc: () => h.deps.doc,
			measured: h.deps.starts.read,
			typeOf: (kind) => ({ name: kind, label: kind }),
			reading: { grammar: defaultGrammarView, resolver: undefined, resolverSignature: '' },
			version: h.contentVersion,
			source: () => serialize(h.deps.doc),
			follow: h.deps.starts.follow
		});
		const two = read.blockOf(h.deps.doc.children[2], [2]);
		const at = { path: docPathFrom([0]), offset: 0 };
		await h.controller.commitStructural({
			snapshot: at,
			mutate(_, scope) {
				scope.own([0])[0].raw = 'ZERO!\n';
				return { op: 'noop' };
			},
			op: { kind: 'input', eventPath: at.path }
		});
		expect(two.from).toBe(serialize(h.deps.doc).indexOf('two'));
	});
});

describe('a held block, read as the writes go by, past what the log of runs holds', () => {
	// Miss-analysis: no row made more writes than the log keeps, so nothing ran the step that
	// drops its oldest half and moves the version its first entry stands for.
	it('keeps its place', () => {
		const h = makeTopHarness('zero\n\none\n\ntwo\n');
		const read = createDocumentRead({
			getDoc: () => h.deps.doc,
			measured: h.deps.starts.read,
			typeOf: (kind) => ({ name: kind, label: kind }),
			reading: { grammar: defaultGrammarView, resolver: undefined, resolverSignature: '' },
			version: h.contentVersion,
			source: () => serialize(h.deps.doc),
			follow: h.deps.starts.follow
		});
		const two = read.blockOf(h.deps.doc.children[2], [2]);
		for (let i = 0; i < 1100; i++) {
			h.deps.starts.duringWrite(() => {
				h.deps.doc.children.unshift(makeNode('paragraph', 'new\n'));
				return { touched: () => [{ at: 0, removed: 0, inserted: 1 }] };
			});
			if (i % 100 === 99) expect(two.from).toBe(serialize(h.deps.doc).indexOf('two'));
		}
	});
});

describe('G4.371 a held block answers only where its node stands', () => {
	const doc = parse('a\n\nb\n\n- c\n') as DocumentView;
	const [, b, list] = doc.children;

	it('passes an answer the walk agrees with, and a miss a reported run explains', () => {
		const covered = { touched: false, covered: true };
		expect(checkHeldBlockPlace(doc, b, [1], covered)).toBeNull();
		expect(checkHeldBlockPlace(doc, b, null, { touched: true, covered: true })).toBeNull();
		expect(checkHeldBlockPlace(doc, b, null, { touched: false, covered: false })).toBeNull();
	});

	it('fails a miss no write reported, and an answer that is not the node’s place', () => {
		const covered = { touched: false, covered: true };
		expect(checkHeldBlockPlace(doc, b, null, covered)?.message).toBe(
			'a held block lost its place, now [1], though no write reported its block changed'
		);
		expect(checkHeldBlockPlace(doc, list.children![0], [1], covered)?.message).toBe(
			'a held block read [1], but its node stands [2, 0]'
		);
	});
});

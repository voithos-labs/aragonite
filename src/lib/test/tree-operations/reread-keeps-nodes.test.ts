// A re-read keeps every block whose bytes it left alone as the node it was, on each route that
// installs one (the byte splice, a spill at the top level, a container taking its own reading, a
// container's reading put in its slot, replace-all), and an undo entry holding such a node never
// sees a later write through it.

import { afterEach, describe, expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { adoptOwnReading } from '#lib/schema/container-raw.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { scanCompiled } from '#lib/test/harness/search-replace.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeListContextAt,
	makeTopHarness,
	type TopHarness
} from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { callSites, collectEditorSources, LIBRARY_ROOTS } from '../invariants/lint/scan-source';

afterEach(() => {
	expect(takeDevWarns()).toEqual([]);
});

/** `text` written as the leaf at `leaf`'s bytes through the keystroke's route. */
function typeInto(h: TopHarness, leaf: number[], text: string): void {
	const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
	const write = legalizeWrite(body, leaf.at(-1)!, text, 'authored', defaultGrammarView);
	expect(h.controller.typeLeaf(docPathFrom(leaf), write, 0).wrote).toBe(true);
}

const splice = (h: TopHarness, from: number, to: number, insert: string) =>
	h.controller.commitSource({
		changes: [{ from, to, insert }],
		caret: { at: from, holds: 'text' },
		op: { kind: 'paste', detail: { count: 1 } },
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});

/** Every `query` replaced by `template` through search's replace-all. */
const replaceAll = (h: TopHarness, query: string, template: string) =>
	createSearchReplace(h.deps, h.controller).replaceAll(scanCompiled(h.deps.doc, query), template);

const at = (root: { children?: CstNode[] }, path: number[]) =>
	path.reduce((node: { children?: CstNode[] }, i) => node.children![i], root) as CstNode;

interface Row {
	source: string;
	reread(h: TopHarness): Promise<void> | void;
	after: string;
	/** Old path, new path: the same node object before and after. */
	kept: [number[], number[]][];
	/** New paths holding a node the re-read made. */
	fresh: number[][];
}

const ROWS: Record<string, Row> = {
	'the byte splice': {
		source: '- a\n- b\n  - c\n  - d\n- e\n',
		reread: async (h) => void (await splice(h, 12, 13, 'cX')),
		after: '- a\n- b\n  - cX\n  - d\n- e\n',
		kept: [
			[
				[0, 0],
				[0, 0]
			],
			[
				[0, 2],
				[0, 2]
			],
			[
				[0, 1, 1, 1],
				[0, 1, 1, 1]
			]
		],
		fresh: [
			[0, 1],
			[0, 1, 1, 0]
		]
	},
	// A blank line between items reads as two lists: the first keeps its item, the second is new.
	'the byte splice, a blank line between items': {
		source: '- a\n- b\n- c\n',
		reread: async (h) => void (await splice(h, 4, 4, '\n')),
		after: '- a\n\n- b\n- c\n',
		kept: [
			[
				[0, 0],
				[0, 0]
			]
		],
		fresh: [
			[1, 0],
			[1, 1]
		]
	},
	'a spill at the top level': {
		source: '- x\n- a b\n\n  c\n',
		reread: (h) => typeInto(h, [0, 1, 0], ' b\n'),
		after: '- x\n-  b\n\n  c\n',
		kept: [
			[
				[0, 0],
				[0, 0]
			]
		],
		fresh: [[0, 1]]
	},
	'a container taking its own reading': {
		source: '- a\n- b\n- c\n',
		reread: (h) => {
			const list = h.deps.doc.children[0];
			list.raw = '- a\n- bX\n- c\n';
			adoptOwnReading(list, defaultGrammarView);
		},
		after: '- a\n- bX\n- c\n',
		kept: [
			[
				[0, 0],
				[0, 0]
			],
			[
				[0, 2],
				[0, 2]
			]
		],
		fresh: [[0, 1]]
	},
	"a container's reading put in its slot": {
		source: '- a b\n  - sub\n- c\n- d\n',
		reread: (h) => typeInto(h, [0, 0, 0], ' b\n'),
		after: '-  b\n  - sub\n- c\n- d\n',
		kept: [
			[
				[0, 1],
				[0, 2]
			],
			[
				[0, 2],
				[0, 3]
			]
		],
		fresh: [[0, 0]]
	},
	'replace-all': {
		source: '- a\n- bX\n- c\n',
		reread: async (h) => void (await replaceAll(h, 'X', 'Y')),
		after: '- a\n- bY\n- c\n',
		kept: [
			[
				[0, 0],
				[0, 0]
			],
			[
				[0, 2],
				[0, 2]
			]
		],
		fresh: [[0, 1]]
	}
};

describe('a re-read keeps the blocks it left alone as the nodes they were', () => {
	it.each(Object.entries(ROWS))('%s', async (_route, row) => {
		const h = makeTopHarness(row.source);
		assignChildIdsDeep(h.deps.doc.children[0]);
		const keptBefore = row.kept.map(([path]) => at(h.deps.doc, path));
		// Read before the re-read, since two routes take their reading into the node in place.
		const old = new Set<unknown>();
		const walk = (nodes: readonly CstNode[] = []) =>
			nodes.forEach((node) => (old.add(node), walk(node.children)));
		walk(h.deps.doc.children);

		await row.reread(h);

		expect(serialize(h.deps.doc)).toBe(row.after);
		row.kept.forEach(([, path], i) => expect(at(h.deps.doc, path)).toBe(keptBefore[i]));
		for (const path of row.fresh) expect(old.has(at(h.deps.doc, path))).toBe(false);
	});
});

/** A route run as its own undo step, then a keystroke into a block it kept. */
interface UndoRow {
	source: string;
	reread(h: TopHarness): Promise<unknown>;
	/** Old path, new path: the block the re-read kept, which holds or is the leaf typed into. */
	kept: [number[], number[]];
	/** The leaf the keystroke goes into, and its new bytes. */
	leaf: number[];
	typed: string;
}

/** A keystroke in a burst of its own, so each lands as its own undo entry. */
const keystroke = (h: TopHarness, leaf: number[], text: string) =>
	h.controller.typingKeystroke(docPathFrom(leaf), 0, leaf.join(), 'join-typing', async () =>
		typeInto(h, leaf, text)
	);

/** Enter after the first character of item 0, whose later blocks move into the new item. */
function splitFirstItem(h: TopHarness) {
	const item = () => h.deps.doc.children[0].children![0];
	registerBlockListState(item(), makeBlockListState(item) as never);
	const { listContext } = makeListContextAt(h.deps, 0, { controller: h.controller });
	return listContext.splitItemAtOffset(0, 0, 1);
}

const UNDO_ROWS: Record<string, UndoRow> = {
	'the byte splice': {
		source: '- a\n- b\n- c\n',
		reread: (h) => splice(h, 6, 7, 'bX'),
		kept: [
			[0, 0],
			[0, 0]
		],
		leaf: [0, 0, 0],
		typed: 'aZ\n'
	},
	'a spill at the top level': {
		source: '- x\n- a b\n\n  c\n',
		reread: (h) => keystroke(h, [0, 1, 0], ' b\n'),
		kept: [
			[0, 0],
			[0, 0]
		],
		leaf: [0, 0, 0],
		typed: 'xZ\n'
	},
	'a container taking its own reading': {
		source: '- a\n\n  b\n\n  c\n',
		reread: splitFirstItem,
		kept: [
			[0, 0, 2],
			[0, 1, 3]
		],
		leaf: [0, 1, 3],
		typed: 'cZ\n'
	},
	"a container's reading put in its slot": {
		source: '- a b\n  - sub\n- c\n- d\n',
		reread: (h) => keystroke(h, [0, 0, 0], ' b\n'),
		kept: [
			[0, 1],
			[0, 2]
		],
		leaf: [0, 2, 0],
		typed: 'cZ\n'
	},
	'replace-all': {
		source: '- a\n- bX\n- c\n',
		reread: (h) => replaceAll(h, 'X', 'Y'),
		kept: [
			[0, 0],
			[0, 0]
		],
		leaf: [0, 0, 0],
		typed: 'aZ\n'
	}
};

describe('an undo entry holding a kept node', () => {
	// Miss-analysis: before nodes were kept, every re-read handed out fresh ones, so no undo entry
	// shared a node with the tree after it, and the first undo row covered the splice alone.
	it.each(Object.entries(UNDO_ROWS))('never sees a later write through it: %s', async (_, row) => {
		const h = makeTopHarness(row.source);
		const [from, to] = row.kept;
		const kept = at(h.deps.doc, from);
		await row.reread(h);
		expect(at(h.deps.doc, to)).toBe(kept);
		const reread = serialize(h.deps.doc);
		await keystroke(h, row.leaf, row.typed);
		expect(at(h.deps.doc, to)).not.toBe(kept);
		const typed = serialize(h.deps.doc);
		const history = createHistoryActions(h.deps, h.controller);
		await history.requestUndo();
		expect(serialize(h.deps.doc)).toBe(reread);
		await history.requestUndo();
		expect(serialize(h.deps.doc)).toBe(row.source);
		await history.requestRedo();
		await history.requestRedo();
		expect(serialize(h.deps.doc)).toBe(typed);
	});
});

describe('the route list', () => {
	const sources = collectEditorSources(LIBRARY_ROOTS).filter(
		(file) => file.relPath !== 'src/lib/block-id.ts'
	);
	const callers = (name: string) =>
		sources.filter((file) => callSites(file.code, name).length > 0).map((file) => file.relPath);

	// A keystroke's block can show text its re-read moved, and a kept id deeper down hides that.
	it('only the byte splice keeps nodes down a changed child', () => {
		expect(callers('keepUnchangedDeep').sort()).toEqual([
			'src/lib/tree-operations/byte-splice.ts',
			'src/lib/tree-operations/container-window.ts'
		]);
	});

	it('every file that keeps a re-read’s nodes is a route with rows above', () => {
		expect(callers('keepUnchanged').sort()).toEqual([
			'src/lib/editor-actions/search-replace.ts',
			'src/lib/schema/container-raw.ts',
			'src/lib/tree-operations/chain-rebuild.ts',
			'src/lib/tree-operations/content-write.ts'
		]);
	});
});

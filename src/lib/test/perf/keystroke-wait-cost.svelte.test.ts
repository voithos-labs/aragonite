// @vitest-environment jsdom
// A key at the foot of a long run of blocks with no blank line asks the look for a wait about each
// pair once; the look keeps those answers, so the next key there asks as few at 8,000 blocks as at
// 2,000, on plain nodes and on the editor's `$state` tree (G4.346).
// Miss-analysis: the keystroke cost rows counted parses and the leaf's own reads, never the asks of
// a walk up the run, which a key under a definition that waits now makes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { Document } from '#lib/core/nodes.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import {
	defaultGrammarView,
	unfinishedReadings,
	type UnfinishedReading
} from '#lib/schema/block-openers.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { opened } from '#lib/test/exhaustive/edit-driver.js';

const word = (i: number) => `word ${String(i).padStart(6, '0')}`;
const DEFINITIONS = (n: number) =>
	Array.from({ length: n }, (_, i) => `[${word(i)}]: /u\n`).join('');

/** What a second key at the end of block `index` asks: `notFinal` calls, and reads of the list. */
function secondKey(doc: Document, index: (doc: Document) => number) {
	const { deps } = makeEditorActionsDeps(doc);
	const typing = createUndoController(deps);
	const at = index(deps.doc);
	const key = () => {
		const raw = deps.doc.children[at].raw;
		const write = legalizeWrite(
			deps.doc,
			at,
			raw.replace(/(\r?\n)?$/, 'x$1'),
			'authored',
			defaultGrammarView
		);
		expect(typing.typeLeaf(docPathFrom([at]), write, 0).wrote).toBe(true);
	};
	// The first key owns the list and fills the look; the second is the one a person feels.
	key();
	const readings = unfinishedReadings(defaultGrammarView) as UnfinishedReading[];
	const saved = readings.map((reading) => reading.notFinal);
	let asks = 0;
	readings.forEach((reading, k) => (reading.notFinal = (raw) => (asks++, saved[k](raw))));
	let reads = 0;
	const list = deps.doc.children;
	deps.doc.children = new Proxy(list, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
			return Reflect.get(target, prop, receiver);
		}
	});
	try {
		key();
	} finally {
		readings.forEach((reading, k) => (reading.notFinal = saved[k]));
		deps.doc.children = list;
	}
	return { asks, reads };
}

const foot = (doc: Document) => doc.children.length - 1;

// The production keystroke: a dev build's checks read the run around a write by design.
beforeEach(() => configureEditorEnv({ isDev: false }));
afterEach(() => resetEditorEnv());

describe('a key at the foot of a run of definitions with no blank line', () => {
	it('asks the look as much at 8,000 definitions as at 2,000', () => {
		const at = (n: number) => secondKey(opened(DEFINITIONS(n)), foot);
		const [small, large] = [at(2000), at(8000)];
		expect(large.asks).toBe(small.asks);
		expect(large.asks).toBeLessThan(10);
		// The walk still reads every pair, at most twice a block more.
		expect(large.reads - small.reads).toBeLessThanOrEqual(2 * (8000 - 2000));
	});

	it('on the editor’s `$state` tree too', () => {
		const at = (n: number) => {
			const doc: Document = $state(opened(DEFINITIONS(n)));
			return secondKey(doc, foot);
		};
		expect(at(8000).asks).toBe(at(2000).asks);
	});
});

describe('a key nowhere near a definition asks what it did', () => {
	const SHAPES: [string, (n: number) => string, number][] = [
		['8,000 headings', (n) => Array.from({ length: n }, (_, i) => `# ${word(i)}\n`).join(''), 5],
		[
			'paragraphs a blank line apart',
			(n) => Array.from({ length: n }, (_, i) => `${word(i)}\n`).join('\n'),
			2
		],
		[
			'text under headings',
			(n) => Array.from({ length: n >> 1 }, (_, i) => `# h\n${word(i)}\n`).join('\n'),
			6
		]
	];
	it.each(SHAPES)('%s', (_, source, asks) => {
		expect(secondKey(opened(source(8000)), foot).asks).toBe(asks);
	});
});

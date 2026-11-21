// @vitest-environment jsdom
// A live cut or drag move conserves a marker pair's sides: the sides before equal the sides left in
// the document plus those on the clipboard or in the moved text, and a cut pasted back, or a move,
// holds each side once. Drawn over one to three blocks of pairs, keyed and not, nested, crossed or
// lone, beside runs and non-ASCII text; the shapes a filed issue leaves broken are named below.
// Miss-analysis: each change to the pair's removal rule came with rows for its own gesture, so a
// drag inside one block that put a side back and carried it too had no row.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { markerPair } from '#lib/plugin.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installInlines } from '#lib/schema/inline-type.js';
import { serialize } from '#lib/core/serializer.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { movedText, runDrop, type SelectionDropDeps } from '#lib/selection/selection-drop.js';
import { replaceDrawnRange } from '#lib/tree-operations/leaf-range.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import type { Reading } from '#lib/schema/reading.js';
import { makeEditorActionsDeps } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';

const SEED = freshOrFixedSeed(20261121);
const RUNS = 150;

// ── The two pairs: keyed by id, and paired by nesting order ────────────────────

const side = (prefix: string, at: RegExp) => ({
	prefix,
	match: at,
	read: (m: RegExpExecArray) => ({ id: m[1] })
});
const anchor = (keyed: boolean) =>
	markerPair({
		name: 'anchor',
		label: 'Comment anchor',
		open: side('{>>', /\{>>(\w)\}/),
		close: side('{<<', /\{<<(\w)\}/),
		key: keyed ? (data) => data.id : undefined,
		sample: 'a {>>c}text{<<c} z'
	});

const readings = new Map<boolean, Reading>();
const releases: (() => void)[] = [];
// Per test: the editor environment, the pair's rows with it, is reset after each.
beforeEach(() => {
	for (const keyed of [true, false]) {
		const name = keyed ? 'keyed' : 'ordered';
		const plugin = { name, version: '1.0.0', editor: '*' as const };
		const contribution = { inlines: [anchor(keyed)] };
		const installed = installInlines([{ name, plugin, contribution }], () => {});
		releases.push(installed.release);
		const grammar = createEditorGrammar({ inlines: () => installed.inlines });
		readings.set(keyed, fixtureReading({ grammar }, 'live'));
	}
});
afterEach(() => releases.splice(0).forEach((release) => release()));

// ── Documents ──────────────────────────────────────────────────────────────────

const WORDS = [
	'alpha',
	'héllo',
	'жук',
	'😀x',
	'ét',
	'**bold**',
	'*it*',
	'b**c**d',
	'~~st~~',
	'<https://x.dev>',
	'end'
];

interface Drawn {
	keyed: boolean;
	blocks: string[];
}

/** A side token placed before word `word` of block `block` (a word index past the last appends). */
interface Placed {
	block: number;
	word: number;
	token: string;
}

const drawnDoc: fc.Arbitrary<Drawn> = fc
	.record({
		keyed: fc.boolean(),
		words: fc.array(fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 }), {
			minLength: 1,
			maxLength: 3
		}),
		pairs: fc.array(
			fc.record({
				open: fc.tuple(fc.nat(2), fc.nat(5)),
				close: fc.tuple(fc.nat(2), fc.nat(5)),
				lone: fc.constantFrom('both', 'both', 'both', 'open', 'close')
			}),
			{ maxLength: 3 }
		),
		glued: fc.array(fc.boolean(), { minLength: 24, maxLength: 24 })
	})
	.map(({ keyed, words, pairs, glued }) => {
		const placed: Placed[] = [];
		pairs.forEach(({ open, close, lone }, i) => {
			const id = 'abcd'[i];
			let [a, b] = [open, close].map(([block, word]) => {
				const at = block % words.length;
				return { block: at, word: word % (words[at].length + 1) };
			});
			if (a.block > b.block || (a.block === b.block && a.word > b.word)) [a, b] = [b, a];
			if (lone !== 'close') placed.push({ ...a, token: `{>>${id}}` });
			if (lone !== 'open') placed.push({ ...b, token: `{<<${id}}` });
		});
		let g = 0;
		const blocks = words.map((line, block) => {
			let out = '';
			for (let word = 0; word <= line.length; word++) {
				for (const p of placed) if (p.block === block && p.word === word) out += p.token;
				if (word < line.length)
					out += line[word] + (word < line.length - 1 && !glued[g++ % 24] ? ' ' : '');
			}
			return out;
		});
		return { keyed, blocks };
	});

const sourceOf = (d: Drawn) => d.blocks.join('\n\n') + '\n';

/** Where block `i` starts in the source. */
const startOf = (d: Drawn, i: number) => d.blocks.slice(0, i).reduce((n, b) => n + b.length + 2, 0);

/** The offsets of `text` a live caret reaches: outside a side's bytes, a delimiter run and a
 *  character's code units. */
function reachable(text: string): number[] {
	const blocked = new Set<number>();
	for (const m of text.matchAll(/\{(?:>>|<<)\w\}|\*+|~+/g)) {
		for (let i = m.index + 1; i < m.index + m[0].length; i++) blocked.add(i);
	}
	const at: number[] = [0];
	let i = 0;
	for (const ch of text.match(/\P{M}\p{M}*/gu) ?? []) {
		i += ch.length;
		if (!blocked.has(i)) at.push(i);
	}
	return at;
}

const pick = <T>(list: readonly T[], n: number) => list[n % list.length];

// ── What a gesture is held to ──────────────────────────────────────────────────

/** Each side spelled in `text`, counted by its bytes. */
function sides(...texts: string[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const text of texts) {
		for (const [token] of text.matchAll(/\{(?:>>|<<)\w\}/g))
			out.set(token, (out.get(token) ?? 0) + 1);
	}
	return out;
}

/** The sides `after` holds more and fewer of than `before`. */
function drift(before: Map<string, number>, after: Map<string, number>) {
	const more: string[] = [];
	const fewer: string[] = [];
	for (const token of new Set([...before.keys(), ...after.keys()])) {
		const d = (after.get(token) ?? 0) - (before.get(token) ?? 0);
		if (d > 0) more.push(token);
		if (d < 0) fewer.push(token);
	}
	return { more, fewer };
}

/** The block holding the partner of `token`, a side of block `i` or `j`, as the join of those two
 *  blocks pairs their sides: by id where the pair is keyed, else by nesting order. -1 for none. */
function joinPartner(d: Drawn, i: number, j: number, token: string): number {
	const opens: { token: string; block: number }[] = [];
	for (const block of [i, j]) {
		for (const [side] of d.blocks[block].matchAll(/\{(?:>>|<<)\w\}/g)) {
			if (side[1] === '>') {
				opens.push({ token: side, block });
				continue;
			}
			const at = opens.findLastIndex((o) => !d.keyed || o.token[3] === side[3]);
			if (at < 0) continue;
			const [open] = opens.splice(at, 1);
			if (side === token) return open.block;
			if (open.token === token) return block;
		}
	}
	return -1;
}

interface Run {
	gesture: 'cut' | 'paste back' | 'drag';
	d: Drawn;
	from: { block: number; at: number };
	to: { block: number; at: number };
	more: string[];
	fewer: string[];
	/** The source block's own removal took the bytes as written: no join cleaned it. */
	literal: boolean;
}

/** The shapes a filed issue leaves broken, each a predicate over the run that breaks the law. */
const EXCLUSIONS: { issue: string; text: string; holds(run: Run): boolean }[] = [
	{
		issue: 'C',
		text: 'A cut across two blocks leaves a side in the document and on the clipboard: each end piece reads its block alone, so it carries a side the join of the two puts back.',
		holds: ({ gesture, d, from, to, more, fewer }) =>
			gesture !== 'drag' &&
			from.block !== to.block &&
			fewer.length === 0 &&
			more.every((token) => {
				const home = d.blocks.findIndex((block) => block.includes(token));
				const partner = joinPartner(d, from.block, to.block, token);
				const ends = [from.block, to.block];
				return ends.includes(home) && ends.includes(partner) && home !== partner;
			})
	},
	{
		issue: 'D',
		text: 'A cut the join can’t verify takes a marker side: where the join declines, the literal splice stands and takes the side with it.',
		holds: ({ more, fewer, literal }) => more.length === 0 && fewer.length > 0 && literal
	}
];

function judged(run: Run): string | null {
	if (run.more.length === 0 && run.fewer.length === 0) return null;
	if (EXCLUSIONS.some((x) => x.holds(run))) return null;
	const { gesture, d, from, to, more, fewer } = run;
	const range = `[${from.block}:${from.at}, ${to.block}:${to.at})`;
	return `${gesture} ${JSON.stringify(sourceOf(d))} keyed=${d.keyed} ${range}: +${more} -${fewer}`;
}

// ── Gestures ───────────────────────────────────────────────────────────────────

const gestureArgs = fc.record({
	d: drawnDoc,
	a: fc.nat(99),
	b: fc.nat(99),
	c: fc.nat(99),
	e: fc.nat(99)
});

function rangeIn(d: Drawn, { a, b, c, e }: { a: number; b: number; c: number; e: number }) {
	const [i, j] = [a % d.blocks.length, b % d.blocks.length].sort((p, q) => p - q);
	let x = pick(reachable(d.blocks[i]), c);
	let y = pick(reachable(d.blocks[j]), e);
	if (i === j && x > y) [x, y] = [y, x];
	return { from: { block: i, at: x }, to: { block: j, at: y } };
}

function cutRuns(d: Drawn, range: ReturnType<typeof rangeIn>): Run[] {
	const source = sourceOf(d);
	const host = { ...rangeHost(readings.get(d.keyed)!), transformPaste: (text: string) => text };
	const from = startOf(d, range.from.block) + range.from.at;
	const to = startOf(d, range.to.block) + range.to.at;
	if (from === to) return [];
	const cut = editRange(source, { from, to }, 'cut', 'live', host);
	const before = sides(source);
	const literal = cut.source === source.slice(0, from) + source.slice(to);
	const run = { d, ...range, literal };
	const kept = drift(before, sides(cut.source, cut.clipboard ?? ''));
	const at = cut.caret.at;
	// The editor's own entry, then the text alone, as another editor or app pastes it.
	const back = (own: string | undefined) =>
		editRange(
			cut.source,
			{ from: at, to: at },
			{ paste: cut.clipboard ?? '', plain: false, own, holds: 'text' },
			'live',
			host
		).source;
	return [
		{ ...run, gesture: 'cut', ...kept },
		{ ...run, gesture: 'paste back', ...drift(before, sides(back(cut.own))) },
		{ ...run, gesture: 'paste back', ...drift(before, sides(back(undefined))) }
	];
}

async function dragRun(
	d: Drawn,
	args: { a: number; b: number; c: number; e: number }
): Promise<Run | null> {
	const block = args.a % d.blocks.length;
	const offsets = reachable(d.blocks[block]);
	const [start, end] = [pick(offsets, args.b), pick(offsets, args.c)].sort((p, q) => p - q);
	const target = args.e % d.blocks.length;
	const at = pick(reachable(d.blocks[target]), args.a + args.e);
	if (start === end || (target === block && at >= start && at <= end)) return null;
	const source = sourceOf(d);
	const reading = readings.get(d.keyed)!;
	const harness = makeEditorActionsDeps(source);
	const controller = createUndoController(harness.deps);
	const deps: SelectionDropDeps = {
		editorRoot: document.createElement('div'),
		getDoc: () => harness.deps.doc,
		controller,
		coordinator: createPasteCoordinator(harness.deps, controller),
		reading,
		activePlugins: everyInstalledPlugin,
		events: harness.events,
		setDropCaret: () => {},
		isReadOnly: () => false
	};
	const from = { path: [block], start, end, inCell: false };
	const text = movedText(deps, from);
	if (text === null) return null;
	const node = blockNodeAt(harness.deps.doc, [block])!;
	const own = replaceDrawnRange(
		node,
		{ start, end },
		'',
		storedAsAt(harness.deps.doc, [block], reading)
	);
	const literal = own.raw === node.raw.slice(0, start) + node.raw.slice(end);
	await runDrop(deps, { ...from, text }, { path: [target], offset: at }, false);
	const after = serialize(harness.deps.doc);
	return {
		gesture: 'drag',
		d,
		from: { block, at: start },
		to: { block, at: end },
		literal,
		...drift(sides(source), sides(after))
	};
}

// ── The law ────────────────────────────────────────────────────────────────────

describe('a live cut or drag conserves a marker pair’s sides', () => {
	it('over cuts, each pasted back', () => {
		const broken: string[] = [];
		fc.assert(
			fc.property(gestureArgs, ({ d, ...args }) => {
				for (const run of cutRuns(d, rangeIn(d, args))) {
					const line = judged(run);
					if (line) broken.push(line);
				}
			}),
			{ seed: SEED, numRuns: RUNS * 4 }
		);
		expect(broken.slice(0, 8)).toEqual([]);
	});

	it('over drag moves', async () => {
		const broken: string[] = [];
		await fc.assert(
			fc.asyncProperty(gestureArgs, async ({ d, ...args }) => {
				const run = await dragRun(d, args);
				const line = run && judged(run);
				if (line) broken.push(line);
			}),
			{ seed: SEED, numRuns: RUNS }
		);
		expect(broken.slice(0, 8)).toEqual([]);
	});
});

// Each exclusion's repro still breaks the law, so the fix that closes its issue deletes the row.
describe('the shapes a filed issue leaves broken', () => {
	it.each<[string, Drawn, [number, number], [number, number]]>([
		['C', { keyed: true, blocks: ['Across {>>b}two', 'blocks{<<b} end'] }, [0, 3], [1, 3]],
		['D', { keyed: true, blocks: ['a {>>c}<https://x.dev>{<<c} z'] }, [0, 14], [0, 28]]
	])('issue %s', (issue, d, [fb, fa], [tb, ta]) => {
		const [cut] = cutRuns(d, { from: { block: fb, at: fa }, to: { block: tb, at: ta } });
		const broke = cut.more.length + cut.fewer.length > 0;
		expect([broke, EXCLUSIONS.find((x) => x.issue === issue)!.holds(cut)]).toEqual([true, true]);
	});
});

// @vitest-environment jsdom
// Miss-analysis: the marker-pair rows removed one character beside a side, never a range across
// one, so a word delete that took one side and left its partner had no row at the shared join.
import { afterEach, describe, expect, it } from 'vitest';
import { markerPair, type MarkerPairSpec } from '#lib/plugin.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installInlines } from '#lib/schema/inline-type.js';
import { makeBlockNode } from '#lib/core/nodes.js';
import { fixtureReading, topLevelStore } from '#lib/test/harness/fixture-grammar.js';
import {
	bytesLeavingLeaf,
	joinLeaves,
	replaceDrawnRange
} from '#lib/tree-operations/leaf-range.js';

type Spec = Partial<MarkerPairSpec<{ id: string }>>;

/** A comment anchor, `{>>id}` and `{<<id}`, its sides paired by their id unless `key` is cut. */
const anchor = (over: Spec = {}) =>
	markerPair({
		name: 'anchor',
		label: 'Comment anchor',
		open: { prefix: '{>>', match: /\{>>([\w-]+)\}/, read: (m: RegExpExecArray) => ({ id: m[1] }) },
		close: { prefix: '{<<', match: /\{<<([\w-]+)\}/, read: (m: RegExpExecArray) => ({ id: m[1] }) },
		key: (data) => data.id,
		sample: 'a {>>c}text{<<c} z',
		...over
	});

let release = () => {};
afterEach(() => release());

function store(raw: string, mode: 'live' | 'source' = 'live', over: Spec = {}) {
	const installed = installInlines(
		[
			{
				name: 'cm',
				plugin: { name: 'cm', version: '1.0.0', editor: '*' },
				contribution: { inlines: [anchor(over)] }
			}
		],
		() => {}
	);
	release = installed.release;
	const reading = fixtureReading(
		{ grammar: createEditorGrammar({ inlines: () => installed.inlines }) },
		mode
	);
	const node = para(raw);
	return { node, store: topLevelStore(node, reading) };
}

const para = (raw: string) =>
	makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: `${raw}\n` });
const text = (raw: string) => raw.slice(0, -1);

function removed(
	raw: string,
	start: number,
	end: number,
	typed = '',
	mode?: 'source',
	over?: Spec
) {
	const at = store(raw, mode, over);
	return text(replaceDrawnRange(at.node, { start, end }, typed, at.store).raw);
}

// `a {>>c}text{<<c} z`: the open side is [2,7), the text [7,11), the close side [11,16).
const PAIR = 'a {>>c}text{<<c} z';
const NESTED = 'x {>>a}p {>>b}q{<<b} r{<<a} y';

describe('a live removal across a marker side', () => {
	it.each<[string, string, number, number, string, string]>([
		['a word delete after the text', PAIR, 7, 17, '', 'a {>>c}{<<c}z'],
		['a word delete from the outer offset', PAIR, 2, 17, '', 'a {>>c}{<<c}z'],
		['a range across the open side', PAIR, 1, 9, '', 'a{>>c}xt{<<c} z'],
		['a range across the close side', PAIR, 9, 17, '', 'a {>>c}te{<<c}z'],
		['a letter over a range across the open side', PAIR, 1, 9, 'Q', 'a{>>c}Qxt{<<c} z'],
		['a letter over a range across the close side', PAIR, 9, 17, 'Q', 'a {>>c}teQ{<<c}z'],
		['the text exactly, inner offsets', PAIR, 7, 11, '', 'a {>>c}{<<c} z'],
		['the text exactly, outer offsets', PAIR, 2, 16, '', 'a {>>c}{<<c} z'],
		['a letter over the text exactly', PAIR, 2, 16, 'Q', 'a {>>c}Q{<<c} z'],
		['the whole pair and a space each side', PAIR, 1, 17, '', 'az'],
		['only a side', PAIR, 2, 7, '', PAIR],
		['nested, across the inner close', NESTED, 14, 22, '', 'x {>>a}p {>>b}{<<b}{<<a} y'],
		['nested, across the outer open', NESTED, 1, 8, '', 'x{>>a} {>>b}q{<<b} r{<<a} y'],
		['nested, across both closes', NESTED, 14, 28, '', 'x {>>a}p {>>b}{<<b}{<<a}y'],
		['a pair inside a bold', '**a {>>c}text{<<c} b**', 9, 19, '', '**a {>>c}{<<c}b**'],
		['a bold inside a pair', 'a {>>c}x **bold** y{<<c} z', 13, 25, '', 'a {>>c}x **bo**{<<c}z'],
		['a pair crossing a bold', '**a {>>c}bold** text{<<c} z', 11, 26, '', '**a {>>c}bo**{<<c}z'],
		['two pairs', 'x {>>a}pq{<<a} y {>>b}rs{<<b} w', 8, 23, '', 'x {>>a}p{<<a}{>>b}s{<<b} w'],
		// p0 {>>a}2-6 x7 {>>b}9-13 y14 {<<a}15-19 z21 {<<b}22-26: overlapping comments.
		[
			'crossed pairs, by key',
			'p {>>a}x {>>b}y{<<a} z{<<b} q',
			8,
			21,
			'',
			'p {>>a}x{>>b}{<<a}z{<<b} q'
		]
	])('%s', (_name, raw, start, end, typed, live) => {
		expect(removed(raw, start, end, typed)).toBe(live);
		expect(removed(raw, start, end, typed, 'source')).toBe(
			raw.slice(0, start) + typed + raw.slice(end)
		);
	});

	it('pairs by nesting order where the pair gives no key', () => {
		const crossed = 'p {>>a}x {>>b}y{<<a} z{<<b} q';
		expect(removed(crossed, 8, 21, '', undefined, { key: undefined })).toBe('p {>>a}xz{<<b} q');
	});

	it('lands a letter typed over a range on the side the pair calls its text', () => {
		const outside: Spec = { text: { open: 'before', close: 'after' } };
		expect(removed(PAIR, 1, 9, 'Q', undefined, outside)).toBe('aQ{>>c}xt{<<c} z');
		expect(removed(PAIR, 9, 17, 'Q', undefined, outside)).toBe('a {>>c}te{<<c}Qz');
	});

	// Limits, as recorded: the join sees no partner past its blocks, and refuses an uncut URL.
	it('takes a side whose partner the block lacks, one in another block or none', () => {
		expect(removed('blocks{<<b} end', 0, 12)).toBe('end');
		expect(removed('A lone {<<x} side', 1, 13)).toBe('Aside');
	});

	it('takes a side when its cut falls inside a URL no reading can cut', () => {
		expect(removed('a {>>c}<https://x.dev>{<<c} z', 14, 28)).toBe('a {>>c}<https:z');
	});
});

describe('a live removal across two blocks', () => {
	function joined(head: string, at: number, tail: string, to: number) {
		const h = store(head);
		const t = para(tail);
		return text(
			joinLeaves({ node: h.node, offset: at }, { node: t, offset: to }, '', h.store, '\n').raw
		);
	}

	it.each<[string, string, number, string, number, string]>([
		['from inside a pair', PAIR, 9, 'next para', 5, 'a {>>c}te{<<c}para'],
		['into a pair', 'first', 2, PAIR, 9, 'fi{>>c}xt{<<c} z'],
		[
			'across the open side of a pair over two blocks',
			'Across {>>b}two',
			3,
			'blocks{<<b} end',
			3,
			'Acr{>>b}cks{<<b} end'
		],
		[
			'across the close side of a pair over two blocks',
			'Across {>>b}two',
			13,
			'blocks{<<b} end',
			12,
			'Across {>>b}t{<<b}end'
		],
		[
			'across both sides of a pair over two blocks',
			'Across {>>b}two',
			3,
			'blocks{<<b} end',
			12,
			'Acrend'
		],
		// The join sees two blocks, so a partner in a third keeps today's bytes.
		['a side whose partner is in a third block', 'x {>>c}a', 1, 'z', 0, 'xz']
	])('%s', (_name, head, at, tail, to, want) => {
		expect(joined(head, at, tail, to)).toBe(want);
	});
});

// After a cut, the sides in the document and on the clipboard are the sides there were before.
describe('what a live range carries off', () => {
	const carried = (raw: string, start: number, end: number, mode?: 'source') => {
		const at = store(raw, mode);
		return bytesLeavingLeaf(at.node, { start, end }, at.store);
	};

	it.each<[string, number, number, string]>([
		['a range across the close side leaves the side behind', 9, 17, 'xt '],
		['a range around the whole pair carries it', 1, 17, ' {>>c}text{<<c} '],
		['the text exactly carries no side', 2, 16, 'text'],
		['a range across both sides carries the pair', 0, 18, PAIR]
	])('%s', (_name, start, end, want) => {
		expect(carried(PAIR, start, end)).toBe(want);
		expect(carried(PAIR, start, end, 'source')).toBe(PAIR.slice(start, end));
	});

	it('carries a side whose partner the block lacks, which the removal takes', () => {
		expect(carried('blocks{<<b} end', 0, 12)).toBe('blocks{<<b} ');
	});

	it('a cut pasted back where it was keeps one pair', () => {
		const at = store(PAIR);
		const off = bytesLeavingLeaf(at.node, { start: 9, end: 17 }, at.store);
		const cut = replaceDrawnRange(at.node, { start: 9, end: 17 }, '', at.store);
		const left = para(text(cut.raw));
		const back = replaceDrawnRange(left, { start: cut.caret, end: cut.caret }, off, {
			...at.store
		});
		expect([text(cut.raw), text(back.raw)]).toEqual(['a {>>c}te{<<c}z', 'a {>>c}text {<<c}z']);
	});
});

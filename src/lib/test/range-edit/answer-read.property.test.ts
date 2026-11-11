// @vitest-environment jsdom
// G4.342 at the host: every document the range-edit core asks the editor's host to read (its
// answer, and the document a paste over a range or a moving drop leaves after its removal half)
// comes back from the splice's windowed read as a fresh parse of the same bytes gives it, block for
// block, and lays out alike at every byte. The core then answers with the same bytes and caret.
// Miss-analysis: new surface; the laws ran the core over a host that parses every document whole,
// so nothing compared the editor's host, which reads an answer off the tree it holds.

import { describe, expect, it } from 'vitest';
import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import { editRange, type Gesture, type Range } from '#lib/range-edit/edit-range.js';
import { rangeHost, type Mode, type PasteHost, type RangeHost } from '#lib/range-edit/host.js';
import { unfinishedReadings, type GrammarView } from '#lib/schema/block-openers.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { lawInputs } from './inputs';
import { rangeOf, unmark } from './named-rows';
import { noTransforms, testReading } from './test-host';

const DOCUMENTS = process.env.RANGE_EDIT_FULL === '1' ? 600 : 120;
const SEED = freshOrFixedSeed(20261111);

interface Compared {
	/** Documents the core asked for beside the editor's own. */
	reads: number;
	/** Those of them whose last block an opener left waiting on a closer. */
	leftOpen: number;
	fails: string[];
}

const blocksOf = (node: { children?: readonly NodeView[] }): unknown[] =>
	(node.children ?? []).map((child) => [
		child.kind,
		child.leadingTrivia,
		child.raw,
		blocksOf(child)
	]);

/** How `got` and its layout differ from `want` and its own, over every byte of `source`. */
function differences(
	source: string,
	got: DocumentView,
	want: DocumentView,
	host: RangeHost,
	fresh: RangeHost
): string[] {
	const out: string[] = [];
	if (JSON.stringify(blocksOf(got)) !== JSON.stringify(blocksOf(want))) out.push('blocks differ');
	if (got.prefix !== want.prefix || got.suffix !== want.suffix) out.push('prefix or suffix differ');
	const laid = host.layout(got);
	const again = fresh.layout(want);
	for (let byte = 0; byte <= source.length; byte++) {
		const point = JSON.stringify(laid.pointAt(byte));
		if (point !== JSON.stringify(again.pointAt(byte))) out.push(`text position at byte ${byte}`);
	}
	const spans = (layout: typeof laid) =>
		JSON.stringify(
			[...layout.within(0, source.length)].map((b) => [
				b.path,
				b.type,
				b.start,
				b.from,
				b.to,
				b.text
			])
		);
	if (spans(laid) !== spans(again)) out.push('block spans differ');
	return out;
}

/** `gesture` run through the editor's host over `source`, every read it makes held to a fresh
 *  parse, then held to the answer a host that parses every document gives. */
function compare(
	into: Compared,
	grammar: GrammarView,
	reading: ReturnType<typeof testReading>,
	call: { source: string; range: Range; gesture: Gesture; mode: Mode }
): void {
	const { source, range, gesture, mode } = call;
	const where = JSON.stringify([source, range, gesture, mode]);
	const fresh = rangeHost(reading);
	const own = rangeHost(reading, { source, measured: measured(fresh.read(source)) });
	const comparing: PasteHost = noTransforms({
		...own,
		read(text) {
			const got = own.read(text);
			if (text === source) return got;
			into.reads++;
			const want = fresh.read(text);
			const last = want.children.at(-1);
			if (last && unfinishedReadings(grammar).some((r) => r.closer && r.notFinal(last.raw)))
				into.leftOpen++;
			for (const line of differences(text, got, want, own, fresh))
				into.fails.push(`${line} in the read of ${JSON.stringify(text)}\n    for ${where}`);
			return got;
		}
	});
	const answer = (host: PasteHost) => {
		try {
			const { source: bytes, caret } = editRange(source, range, gesture, mode, host);
			return JSON.stringify({ bytes, caret });
		} catch (error) {
			return `threw: ${(error as Error).message}`;
		}
	};
	const got = answer(comparing);
	const want = answer(noTransforms(fresh));
	if (got !== want)
		into.fails.push(`answered ${got}, a fresh parse answers ${want}\n    for ${where}`);
}

const report = ({ fails }: Compared) =>
	fails.length === 0 ? '' : `${fails.slice(0, 12).join('\n')}\n(${fails.length} in all)`;

const paste = (text: string, plain = false): Gesture => ({ paste: text, plain, holds: 'text' });

describe('G4.342 the editor’s host reads an answer as a fresh parse does', () => {
	it(`over ${DOCUMENTS} drawn documents, seed ${SEED}`, { timeout: DOCUMENTS * 1500 }, () => {
		const reading = testReading();
		const { grammar } = reading;
		const seen: Compared = { reads: 0, leftOpen: 0, fails: [] };
		let overRange = 0;
		for (const input of lawInputs(DOCUMENTS, SEED, grammar)) {
			const { source, mode } = input;
			const run = (range: Range, gesture: Gesture) =>
				compare(seen, grammar, reading, { source, range, gesture, mode });
			for (const { from, to, text } of input.ranges) {
				const range = { from, to };
				for (const gesture of ['backspace', 'delete', 'cut', 'type'] as const) run(range, gesture);
				// A paste over a range reads the document its removal half leaves, then its answer.
				const before = seen.reads;
				run(range, paste(text));
				if (seen.reads - before > 1) overRange++;
				run(range, paste(text, true));
				const drop = input.carets[0]?.at ?? 0;
				if (drop < from || drop > to) run(range, { drop, copy: false });
			}
			for (const { at, texts } of input.carets) run({ from: at, to: at }, paste(texts[0]));
		}
		expect(report(seen)).toBe('');
		// Not vacuous: answers were read, and a paste read the document after its removal half.
		expect(seen.reads).toBeGreaterThan(DOCUMENTS);
		expect(overRange).toBeGreaterThan(0);
	});

	it.each([
		{ name: 'at a caret', marked: 'one\n\ntw⟦⟧o\n\nthree\n\nfour\n' },
		{ name: 'over a range in one paragraph', marked: 'one\n\nt⟦w⟧o\n\nthree\n\nfour\n' },
		{ name: 'over a range across blocks', marked: 'one\n\ntw⟦o\n\nth⟧ree\n\nfour\n' },
		{ name: 'inside a quote', marked: '> one\n>\n> tw⟦o\n>\n> th⟧ree\n\nafter\n\nlast\n' },
		{ name: 'inside a list item', marked: '- one\n- tw⟦o\n- th⟧ree\n\nafter\n\nlast\n' }
	])('a paste that leaves a fence open: $name', ({ marked }) => {
		const reading = testReading();
		const seen: Compared = { reads: 0, leftOpen: 0, fails: [] };
		const source = unmark(marked);
		const range = rangeOf(marked);
		for (const mode of ['source', 'live'] as const) {
			for (const text of ['```\nopen', 'text\n\n~~~js\nopen\n'])
				compare(seen, reading.grammar, reading, { source, range, gesture: paste(text), mode });
		}
		expect(report(seen)).toBe('');
		expect(seen.leftOpen).toBeGreaterThan(0);
	});

	// Miss-analysis: the rows above skip the read of the editor's own bytes, and no row held an
	// editor with none, whose tree is one empty paragraph where a parse of no bytes gives no block.
	it('an empty editor’s own bytes read as the tree it holds, laid out as it was handed', () => {
		const empty: DocumentView = {
			kind: 'document',
			prefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: '' }],
			suffix: ''
		};
		const laid = measured(empty);
		const layout = documentLayout(laid);
		const host = rangeHost(testReading(), { source: '', measured: laid, layout });
		expect(host.read('')).toBe(empty);
		expect(host.layout(host.read(''))).toBe(layout);
	});
});

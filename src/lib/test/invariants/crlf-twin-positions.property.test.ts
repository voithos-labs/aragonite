/**
 * G1.250: every block of a CRLF document reads at its LF twin's bytes. A document drawn with LF
 * endings is read beside its CRLF twin and a mixed one (every other ending CRLF). Each block's
 * `from`, `to`, the `byteAt` of each character, `offsetAt` back from each and from `to`, and its
 * pieces' and title's bounds equal the LF answer carried past the endings before it: a `\n` written
 * `\r\n` puts its `\r` at the carried byte and its `\n` one past, and a span ends past its last
 * character's carried byte. A position LF already gets wrong (a tab cut by a marker) twins as it
 * is, so the file holds the endings alone. One shape is waived and pinned: an alert's empty body.
 * Miss-analysis: the byte map was tested only at caret positions and against itself, and no
 * read-model suite placed a nested block's characters in a CRLF document.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Block, Doc, Piece } from '#lib/schema/doc-view.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { createDocumentRead } from '#lib/editor-actions/commit/document-read.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbLawDocument } from '../range-laws/shapes';
import { freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 300, seed: freshOrFixedSeed(20261125) } as const;

/** One of each nested kind, and the shapes a byte map finds hard: lazy, tab, blank `>`, no ending. */
const FIXED = [
	'intro\n\n> foo bar\n> baz qux\n',
	'- foo bar\n  baz qux\n- next\n',
	':::note Title\nfoo bar\nbaz qux\n:::\n',
	'> [!NOTE]\n> foo bar\n> baz qux\n',
	'<details>\n<summary>T</summary>\n\nfoo bar\nbaz qux\n\n</details>\n',
	'x[^1]\n\n[^1]: foo bar\n    baz qux\n',
	'| foo | bar |\n|---|---|\n| baz | qux |\n',
	'> a\n> b\nlazy\n',
	'>\ta\n> > b\n',
	'> a\n>\n> b\n',
	'> a\n> b',
	'- a\n  b\n\n  c\n- d'
];

beforeEach(() => installPlugins(SYNTAX_PLUGINS));

// The read a mounted editor and `grammar(...).parse` make, over the syntax installed page-wide.
function read(text: string): Doc {
	const { doc, resolver, signature } = initDocument(text, defaultGrammarView);
	const of = measured(doc);
	return createDocumentRead({
		getDoc: () => doc,
		measured: () => of,
		typeOf: (kind) => ({ name: kind, label: kind }),
		reading: { grammar: defaultGrammarView, resolver, resolverSignature: signature },
		version: () => 0,
		source: () => text
	}).doc();
}

/** `lf` with the endings `crlf` picks (by their index) written `\r\n`, and where each LF byte went. */
function twin(lf: string, crlf: (index: number) => boolean) {
	let text = '';
	const carried: number[] = [];
	let index = 0;
	for (let at = 0; at <= lf.length; at++) {
		carried.push(text.length);
		if (at === lf.length) break;
		const wide = lf[at] === '\n' && crlf(index++);
		text += wide ? '\r\n' : lf[at];
	}
	return { text, carried };
}

// The byte map puts both bytes of an empty body's CRLF ending, which no raw line of an alert's
// carries, on its `\r` (`pairLines.toRaw`); the last row pins it, and the waiver goes once it reds.
const emptyAlertBody = (block: Block) =>
	block.parent?.type.name === 'githubAlert' && block.index === 0 && /^\r?\n$/.test(block.text);

/** What `twinBlock` must read for each of `lfBlock`'s answers, or why the two don't pair. */
function misreads(lfBlock: Block, twinBlock: Block, carried: number[]): string | null {
	const name = `${lfBlock.type.name} ${JSON.stringify(lfBlock.text)}`;
	if (lfBlock.type.name !== twinBlock.type.name)
		return `${name} reads as a ${twinBlock.type.name} in its twin`;
	// Each LF character's index in the twin's text; a `\n` written `\r\n` takes two.
	const at: number[] = [];
	const lf = lfBlock.text;
	const tw = twinBlock.text;
	let j = 0;
	for (let i = 0; i < lf.length; i++, j++) {
		at.push(j);
		if (lf[i] === '\n' && tw[j] === '\r' && tw[j + 1] === '\n') j++;
		else if (lf[i] !== tw[j]) return `${name}: character ${i} reads ${JSON.stringify(tw[j])}`;
	}
	if (j !== tw.length) return `${name}: its twin's text runs on to ${JSON.stringify(tw)}`;
	const index = (k: number | null) => (k === null ? null : k === lf.length ? tw.length : at[k]);
	const want: [string, unknown, unknown][] = [
		['from', carried[lfBlock.from], twinBlock.from],
		['to', carried[lfBlock.to], twinBlock.to],
		['offsetAt(to)', index(lfBlock.offsetAt(lfBlock.to)), twinBlock.offsetAt(twinBlock.to)]
	];
	for (let i = 0; i < lf.length; i++) {
		const byte = carried[lfBlock.byteAt(i)];
		const back = lfBlock.offsetAt(lfBlock.byteAt(i));
		want.push([`byteAt(${at[i]})`, byte, twinBlock.byteAt(at[i])]);
		want.push([`offsetAt of ${at[i]}`, index(back), twinBlock.offsetAt(twinBlock.byteAt(at[i]))]);
		if (tw[at[i]] !== '\r' || lf[i] !== '\n') continue;
		want.push([`byteAt(${at[i] + 1})`, byte + 1, twinBlock.byteAt(at[i] + 1)]);
		const nl = back === i ? at[i] + 1 : index(back);
		want.push([`offsetAt of ${at[i] + 1}`, nl, twinBlock.offsetAt(twinBlock.byteAt(at[i] + 1))]);
	}
	const { title } = lfBlock;
	const twinTitle = twinBlock.title && [twinBlock.title.from, twinBlock.title.to];
	want.push(['title', title && carriedSpan(title, title, twinBlock.title!, carried), twinTitle]);
	want.push([
		'pieces',
		carriedPieces(lfBlock.pieces, twinBlock.pieces, carried),
		spans(twinBlock.pieces)
	]);
	const wrong = want.find(([, expected, got]) => JSON.stringify(expected) !== JSON.stringify(got));
	return wrong ? `${name}: ${wrong[0]} is ${wrong[2]}, its LF twin's ${wrong[1]}` : null;
}

// A span ends past its last character's byte, so its end is carried from that byte, and from the
// `\n` one further where its last `\n` was written `\r\n`.
function carriedSpan(
	span: { from: number; to: number },
	lf: { text: string },
	tw: { text: string },
	carried: number[]
): number[] {
	if (span.to <= span.from) return [carried[span.from], carried[span.from]];
	const pair = lf.text.endsWith('\n') && tw.text.endsWith('\r\n') ? 1 : 0;
	return [carried[span.from], carried[span.to - 1] + 1 + pair];
}

function carriedPieces(lf: readonly Piece[], tw: readonly Piece[], carried: number[]): unknown[] {
	return lf.map((p, k) => {
		const twin = tw[k] ?? p;
		return [
			p.kind,
			...carriedSpan(p, p, twin, carried),
			carriedPieces(p.children, twin.children, carried)
		];
	});
}

function spans(pieces: readonly Piece[]): unknown[] {
	return pieces.map((p) => [p.kind, p.from, p.to, spans(p.children)]);
}

function twinsMisread(source: string): string | null {
	const lf = source.replace(/\r\n?/g, '\n');
	// An empty text has no ending to write, and reads a paragraph none of its bytes hold.
	if (!lf.includes('\n')) return null;
	const lfBlocks = [...read(lf).walk()];
	for (const crlf of [() => true, (index: number) => index % 2 === 0]) {
		const { text, carried } = twin(lf, crlf);
		const blocks = [...read(text).walk()];
		if (blocks.length !== lfBlocks.length)
			return `${JSON.stringify(text)} walks ${blocks.length} blocks, its LF twin ${lfBlocks.length}`;
		for (let k = 0; k < blocks.length; k++) {
			if (emptyAlertBody(blocks[k])) continue;
			const wrong = misreads(lfBlocks[k], blocks[k], carried);
			if (wrong) return `${JSON.stringify(text)}: ${wrong}`;
		}
	}
	return null;
}

describe('G1.250 every block of a CRLF document reads at its LF twin bytes', () => {
	it('reads each nested kind the fixed shapes stand for', () => {
		const kinds = new Set(
			FIXED.flatMap((source) => [...read(source).walk()].map((b) => b.type.name))
		);
		for (const kind of ['details', 'details.title', 'admonition', 'githubAlert', 'footnote-def'])
			expect(kinds.has(kind), kind).toBe(true);
	});

	it.each(FIXED)('reads %j at its twins bytes', (source) => {
		expect(twinsMisread(source)).toBeNull();
	});

	it("still reads an alert's empty body with both bytes of its CRLF ending on the `\\r`", () => {
		const { text, carried } = twin('> [!NOTE]\n', () => true);
		const [lfBody, body] = [read('> [!NOTE]\n'), read(text)].map((doc) => [...doc.walk()][1]);
		expect(emptyAlertBody(body)).toBe(true);
		expect([body.text, body.byteAt(0), body.byteAt(1)]).toEqual(['\r\n', 9, 9]);
		expect(misreads(lfBody, body, carried)).toMatch(/offsetAt of 0 is 1, its LF twin's 0/);
	});

	it('reads every drawn document at its twins bytes', () => {
		fc.assert(
			fc.property(arbLawDocument, (source) => {
				expect(twinsMisread(source)).toBeNull();
			}),
			PARAMS
		);
	}, 30_000);
});

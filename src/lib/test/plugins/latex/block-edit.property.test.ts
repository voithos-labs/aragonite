// @vitest-environment jsdom
// After one edit to a `$$` source, the painted source, the bytes its blur writes and a reload
// agree on the block and its body, and the blocks below read as before unless a `$$` line was
// left to pair with one of theirs. All three go through the block type an editor running latex
// installs: its drawing's reshape and paint, the editor's write and the editor's reading.
// Miss-analysis: the painter, the write rule and the parser each had their own fixtures.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib';
import {
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type CodePainter,
	type LineEnding
} from '#lib/plugin.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import { makingOf } from '#lib/schema/block-type.js';
import { drawingOf } from '#lib/schema/drawing.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/property-seed.js';
import { latex } from '#packages/latex/src/index.js';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(688) } as const;

// A paragraph, then a multi-line equation whose opener a stray `$$` above would pair with.
const BELOW = 'after\n\n$$\ny\n$$\n';

const MATH = 'latex/block';

/** The editor's reading and the block type's drawing, made per row: the suite's reset after
 *  each row drops what an install held. */
function installed() {
	const { units, grammar } = listGrammar([latex], ({ cause }) => {
		throw cause;
	});
	return { grammar, drawing: drawingOf(makingOf(units[0].contribution.blocks![0])!.view) };
}

let math: ReturnType<typeof installed>;

/** Paints a body as its text, as an editor with no highlighter does. */
const plainPainter: CodePainter = { code: (body) => document.createTextNode(body) };

type Edit = { kind: 'break'; at: number } | { kind: 'delete'; at: number };

/** The text the leaf paints after an edit: the edit, then the kind's own reshape. */
const painted = (text: string, caret: number, eol: LineEnding) =>
	math.drawing.reshapeSource!(text, caret, eol)?.text ?? text;

/** Opener and closer read off the fence-line markers, the body and the text past the closer as
 *  painted; null when the painter draws no fence line. */
function paintedSplit(text: string) {
	const nodes = Array.from(math.drawing.renderSource!(text, plainPainter).childNodes);
	const fences = nodes.flatMap((node, i) =>
		node instanceof Element && node.classList.contains('md-fence-line') ? [i] : []
	);
	if (fences.length === 0) return null;
	const [openerAt, closerAt] = fences;
	const textOf = (from: number, to?: number) =>
		nodes
			.slice(from, to)
			.map((node) => node.textContent ?? '')
			.join('');
	const markers = closerAt === undefined ? [] : [...nodes[closerAt].childNodes];
	const closerMarker = markers.filter((node) => node instanceof Element).pop();
	return {
		opener: textOf(openerAt, openerAt + 1),
		body: textOf(openerAt + 1, closerAt),
		closer: closerMarker?.textContent ?? '',
		after: closerAt === undefined ? '' : textOf(closerAt + 1)
	};
}

const read = (source: string) => parse(source, { grammar: math.grammar as GrammarView });

/** Code-point and line-ending boundaries: where a caret can sit and what one delete removes. */
function units(text: string): string[] {
	return text.match(/\r\n|[\s\S]/gu) ?? [];
}

/** The text after the edit, and the caret it leaves. */
function applyEdit(text: string, edit: Edit, eol: LineEnding): { text: string; caret: number } {
	const parts = units(text);
	const before = parts.slice(0, edit.at).join('');
	if (edit.kind === 'break') {
		return {
			text: before + eol + parts.slice(edit.at).join(''),
			caret: before.length + eol.length
		};
	}
	return { text: before + parts.slice(edit.at + 1).join(''), caret: before.length };
}

const blocksOf = (source: string) =>
	read(source).children.map((c) => ({ kind: c.kind, raw: c.raw }));

/** Whether `bytes` hold a `$$` fence line that no math block of their own reading holds. */
function strandsFence(bytes: string): boolean {
	const fenceLines = (raw: string) => raw.split(/\r?\n/).filter((line) => line === '$$').length;
	const held = read(bytes)
		.children.filter((c) => c.kind === MATH)
		.reduce((sum, c) => sum + fenceLines(c.raw), 0);
	return fenceLines(bytes) > held;
}

/** The source after one edit, painted, written on blur, and read back with what sits below;
 *  returns which shape the edit made, for the generator's coverage check. */
function checkEdit(block: string, eol: LineEnding, edit: Edit): string {
	const source = block + eol + eol + BELOW.replace(/\n/g, eol);
	const doc = read(source);
	const node = doc.children[0];
	const edited = applyEdit(painted(block, 0, eol), edit, eol);
	const text = painted(edited.text, edited.caret, eol);
	const written = legalizeWrite(
		doc,
		0,
		text + ownTrailingLineEnding(node.raw),
		'authored',
		math.grammar
	).text;
	const reload = written + source.slice(node.raw.length);
	const label = `${JSON.stringify(block)} ${edit.kind}@${edit.at} -> ${JSON.stringify(text)}`;

	const below = blocksOf(source).slice(1);
	const now = blocksOf(reload);
	// A `$$` line the edit left outside the block pairs with the next one below, as a reload reads it.
	if (!strandsFence(written)) {
		expect(now.slice(now.length - below.length), `${label}: the blocks below moved`).toEqual(below);
	}
	// The same bytes arriving whole (a paste, a replace) mustn't move them either.
	const literal = legalizeWrite(
		doc,
		0,
		text + ownTrailingLineEnding(node.raw),
		'literal',
		math.grammar
	).text;
	const pasted = blocksOf(literal + source.slice(node.raw.length));
	if (!strandsFence(literal)) {
		expect(
			pasted.slice(pasted.length - below.length),
			`${label}: a literal write moved them`
		).toEqual(below);
	}

	// A break before the opener moves the whole block down a line, which no painter reads.
	if (text.startsWith(eol)) return 'moved down';
	const shown = paintedSplit(text);
	const reloaded = now[0].kind === MATH;
	expect(reloaded, `${label}: painted and reloaded disagree on the block`).toBe(shown !== null);
	if (!shown) return 'not math';
	const kept = paintedSplit(trimTrailingLineEnding(now[0].raw));
	expect(kept?.body, `${label}: painted and reloaded disagree on the body`).toBe(shown.body);
	if (shown.closer && shown.after === '') {
		expect(trimTrailingLineEnding(written), `${label}: the blur rewrote a closed source`).toBe(
			text
		);
	}
	if (shown.after !== '') return 'split';
	if (text !== edited.text) return 'reshaped';
	return shown.closer ? 'closed' : 'open';
}

// ── Generators ───────────────────────────────────────────────────────────────

const arbChar = fc.constantFrom('x', '^', '2', '\\', '{', '}', ' ', '$', 'é', '𝛼');
const arbLine = fc.array(arbChar, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(''));

const arbOneLine = arbLine.map((body) => `$$${body}$$`);
const arbMultiLine = (eol: LineEnding) =>
	fc
		.array(fc.oneof(arbLine, fc.constant('')), { minLength: 1, maxLength: 3 })
		.map((lines) => ['$$', ...lines, '$$'].join(eol));

/** A source the parser reads as one math block on its own, with an edit at a caret position. */
const arbCase = fc
	.tuple(fc.constantFrom<LineEnding>('\n', '\r\n'), fc.boolean())
	.chain(([eol, oneLine]) => fc.tuple(fc.constant(eol), oneLine ? arbOneLine : arbMultiLine(eol)))
	.filter(([eol, block]) => {
		const children = read(block + eol).children;
		return children.length === 1 && children[0].kind === MATH;
	})
	.chain(([eol, block]) => {
		const shown = units(painted(block, 0, eol)).length;
		const edit: fc.Arbitrary<Edit> = fc.oneof(
			fc.integer({ min: 0, max: shown }).map((at) => ({ kind: 'break' as const, at })),
			fc.integer({ min: 0, max: shown - 1 }).map((at) => ({ kind: 'delete' as const, at }))
		);
		return fc.tuple(fc.constant(eol), fc.constant(block), edit);
	});

// ── Rows ─────────────────────────────────────────────────────────────────────

describe('one edit to a $$ source reads the same painted, written and reloaded', () => {
	const pinned: Array<[label: string, block: string, edit: Edit]> = [
		['a break at the end of a one-line body', '$$x^2$$', { kind: 'break', at: 5 }],
		['a break at the start of a one-line body', '$$x^2$$', { kind: 'break', at: 2 }],
		['a break inside a one-line body', '$$x^2$$', { kind: 'break', at: 3 }],
		['a break between the closer’s dollars', '$$x^2$$', { kind: 'break', at: 6 }],
		['a deleted closer dollar', '$$x^2$$', { kind: 'delete', at: 6 }],
		['a deleted opener dollar of the multi-line form', '$$\nx^2\n$$', { kind: 'delete', at: 0 }],
		['a break inside the multi-line opener', '$$\nx^2\n$$', { kind: 'break', at: 1 }]
	];
	for (const [label, block, edit] of pinned) {
		it(label, () => {
			math = installed();
			checkEdit(block, '\n', edit);
		});
	}

	it('for any one-line or multi-line source and any one edit', () => {
		math = installed();
		const shapes = new Set<string>();
		fc.assert(
			fc.property(arbCase, ([eol, block, edit]) => {
				shapes.add(checkEdit(block, eol, edit));
			}),
			PARAMS
		);
		// A generator that never drew one of these would pass the property above for nothing.
		expect([...shapes].sort()).toEqual([
			'closed',
			'moved down',
			'not math',
			'open',
			'reshaped',
			'split'
		]);
	});
});

// @vitest-environment jsdom
// After one line break or deleted character in a `$$` source, the painted source, the bytes its
// blur writes and a reload agree on the block and its body, and every block below reads as before.
// Miss-analysis: the painter, the write rule and the parser each had their own fixtures, never
// one edited source handed to all three.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib';
import { ownTrailingLineEnding, trimTrailingLineEnding, type LineEnding } from '#lib/plugin.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { reshapeMathEdit } from '#lib/plugins/latex/math-source.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/property-seed.js';
import { paintedSplit } from './painted-split';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(688) } as const;

// A paragraph, then a multi-line equation whose opener a stray `$$` above would pair with.
const BELOW = 'after\n\n$$\ny\n$$\n';

beforeEach(() => {
	registerMathBlock();
});

type Edit = { kind: 'break'; at: number } | { kind: 'delete'; at: number };

/** The text the leaf paints after an edit: the edit, then the kind's own reshape. */
const painted = (text: string, caret: number, eol: LineEnding) =>
	reshapeMathEdit(text, caret, eol)?.text ?? text;

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
	parse(source).children.map((c) => ({ kind: c.kind, raw: c.raw }));

/** The source after one edit, painted, written on blur, and read back with what sits below;
 *  returns which shape the edit made, for the generator's coverage check. */
function checkEdit(block: string, eol: LineEnding, edit: Edit): string {
	const source = block + eol + eol + BELOW.replace(/\n/g, eol);
	const doc = parse(source);
	const node = doc.children[0];
	const edited = applyEdit(painted(block, 0, eol), edit, eol);
	const text = painted(edited.text, edited.caret, eol);
	const written = legalizeWrite(doc, 0, text + ownTrailingLineEnding(node.raw), 'authored').text;
	const reload = written + source.slice(node.raw.length);
	const label = `${JSON.stringify(block)} ${edit.kind}@${edit.at} -> ${JSON.stringify(text)}`;

	const below = blocksOf(source).slice(1);
	const now = blocksOf(reload);
	expect(now.slice(now.length - below.length), `${label}: the blocks below moved`).toEqual(below);
	// The same bytes arriving whole (a paste, a replace) mustn't move them either.
	const literal = legalizeWrite(doc, 0, text + ownTrailingLineEnding(node.raw), 'literal').text;
	const pasted = blocksOf(literal + source.slice(node.raw.length));
	expect(
		pasted.slice(pasted.length - below.length),
		`${label}: a literal write moved them`
	).toEqual(below);

	// A break before the opener moves the whole block down a line, which no painter reads.
	if (text.startsWith(eol)) return 'moved down';
	const shown = paintedSplit(text);
	const reloaded = now[0].kind === 'mathBlock';
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
		const children = parse(block + eol).children;
		return children.length === 1 && children[0].kind === 'mathBlock';
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
		it(label, () => checkEdit(block, '\n', edit));
	}

	it('for any one-line or multi-line source and any one edit', () => {
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

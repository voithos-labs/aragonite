// @vitest-environment jsdom
// After one line break or deleted character in a `$$` source, the painted source, the bytes its
// blur writes and a reload agree on the block and its body, and every block below reads as before.
// Miss-analysis: the painter, the write rule and the parser each had their own fixtures, never
// one edited source handed to all three.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parse } from '$lib';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '$lib/plugin';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { completeBareMathSource, renderMathSource } from '$lib/plugins/latex/math-source';
import { freshOrFixedSeed } from '$lib/test/invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(688) } as const;

// A paragraph, then a multi-line equation whose opener a stray `$$` above would pair with.
const BELOW = 'after\n\n$$\ny\n$$\n';

beforeEach(() => {
	registerMathBlock();
});

type Edit = { kind: 'break'; at: number } | { kind: 'delete'; at: number };

interface Reading {
	math: boolean;
	/** The text the source paints outside its fence lines. */
	body: string;
	/** How many fence lines it paints: two once the block is closed. */
	fences: number;
}

function paintedReading(text: string): Reading {
	const frag = renderMathSource(text);
	const isFence = (node: Node) =>
		node instanceof Element && node.classList.contains('md-fence-line');
	const nodes = Array.from(frag.childNodes);
	const body = nodes.filter((node) => !isFence(node)).map((node) => node.textContent ?? '');
	const fences = nodes.filter(isFence).length;
	return { math: fences > 0, body: body.join(''), fences };
}

/** The text the leaf paints after an edit: the edit, then the kind's own completion. */
const painted = (text: string, eol: string) => completeBareMathSource(text, eol)?.text ?? text;

/** Code-point and line-ending boundaries: where a caret can sit and what one delete removes. */
function units(text: string): string[] {
	return text.match(/\r\n|[\s\S]/gu) ?? [];
}

function applyEdit(text: string, edit: Edit, eol: string): string {
	const parts = units(text);
	const before = parts.slice(0, edit.at).join('');
	if (edit.kind === 'break') return before + eol + parts.slice(edit.at).join('');
	return before + parts.slice(edit.at + 1).join('');
}

const blocksOf = (source: string) =>
	parse(source).children.map((c) => ({ kind: c.kind, raw: c.raw }));

/** The source after one edit, painted, written on blur, and read back with what sits below. */
function checkEdit(block: string, eol: string, edit: Edit): void {
	const source = block + eol + eol + BELOW.replace(/\n/g, eol);
	const doc = parse(source);
	const node = doc.children[0];
	const text = painted(applyEdit(painted(block, eol), edit, eol), eol);
	const written = legalizeWrite(doc, 0, text + ownTrailingLineEnding(node.raw), 'authored').text;
	const after = written + source.slice(node.raw.length);
	const label = `${JSON.stringify(block)} ${edit.kind}@${edit.at} -> ${JSON.stringify(text)}`;

	const below = blocksOf(source).slice(1);
	const now = blocksOf(after);
	expect(now.slice(now.length - below.length), `${label}: the blocks below moved`).toEqual(below);

	// A break before the opener moves the whole block down a line, which no painter reads.
	if (text.startsWith(eol)) return;
	const shown = paintedReading(text);
	const reloaded = now[0].kind === 'mathBlock';
	expect(reloaded, `${label}: painted and reloaded disagree on the block`).toBe(shown.math);
	if (!shown.math) return;
	const kept = paintedReading(trimTrailingLineEnding(now[0].raw));
	expect(kept.body, `${label}: painted and reloaded disagree on the body`).toBe(shown.body);
	if (shown.fences === 2) {
		expect(trimTrailingLineEnding(written), `${label}: the blur rewrote a closed source`).toBe(
			text
		);
	}
}

// ── Generators ───────────────────────────────────────────────────────────────

const arbChar = fc.constantFrom('x', '^', '2', '\\', '{', '}', ' ', '$', 'é', '𝛼');
const arbLine = fc.array(arbChar, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(''));

const arbOneLine = arbLine.map((body) => `$$${body}$$`);
const arbMultiLine = (eol: string) =>
	fc
		.array(fc.oneof(arbLine, fc.constant('')), { minLength: 1, maxLength: 3 })
		.map((lines) => ['$$', ...lines, '$$'].join(eol));

/** A source the parser reads as one math block on its own, with an edit at a caret position. */
const arbCase = fc
	.tuple(fc.constantFrom('\n', '\r\n'), fc.boolean())
	.chain(([eol, oneLine]) => fc.tuple(fc.constant(eol), oneLine ? arbOneLine : arbMultiLine(eol)))
	.filter(([eol, block]) => {
		const children = parse(block + eol).children;
		return children.length === 1 && children[0].kind === 'mathBlock';
	})
	.chain(([eol, block]) => {
		const shown = units(painted(block, eol)).length;
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
		fc.assert(
			fc.property(arbCase, ([eol, block, edit]) => {
				checkEdit(block, eol, edit);
			}),
			PARAMS
		);
	});
});

// Every position the caret-reachable order hands out is a leaf a mounted caret can sit in: no
// ancestor is a collapsed container holding it in its hidden body. The generator mixes quotes,
// nested lists, tables and open or closed details nested in each other, with non-ASCII text and
// both line endings; with every details open, the caret order equals the coverage order.
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import type { CstNode, Document } from '../../core/nodes';
import { CURSOR_END, CURSOR_START, FOCUS_LAST_START } from '../../block-component';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { isStrictAncestorOf } from '../../selection/path-math';
import {
	firstCaretLeaf,
	firstLeafAtOrAfter,
	firstPath,
	lastCaretLeaf,
	lastLeafAtOrBefore,
	lastPath,
	nextCaretPath,
	nextPath,
	previousCaretPath,
	previousPath
} from '../../selection/path-lookup';
import { caretTargetFor, survivorAfterRemoval } from '../../selection/caret-target';
import { registerChromePluginsForTests } from './chrome-plugins';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 150, seed: freshOrFixedSeed(483001) } as const;

beforeAll(registerChromePluginsForTests);

// ── Generator ───────────────────────────────────────────────────────────────

type Block =
	| { t: 'para'; text: string }
	| { t: 'quote'; kids: Block[] }
	| { t: 'list'; items: Block[][] }
	| { t: 'table'; rows: number; cols: number }
	| { t: 'details'; open: boolean; kids: Block[] };

const WORDS = ['alpha', 'é', '😀x', 'é', 'Ω beta', '**b**'];
const arbPara = fc
	.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 })
	.map((w): Block => ({ t: 'para', text: w.join(' ') }));
const arbTable = fc
	.record({ rows: fc.integer({ min: 1, max: 3 }), cols: fc.integer({ min: 2, max: 4 }) })
	.map((r): Block => ({ t: 'table', ...r }));

const { block: arbBlock } = fc.letrec<{ block: Block; kids: Block[] }>((tie) => ({
	block: fc.oneof(
		{ maxDepth: 4, depthIdentifier: 'block' },
		arbPara,
		arbTable,
		tie('kids').map((kids): Block => ({ t: 'quote', kids })),
		fc
			.array(
				fc.tuple(arbPara, tie('kids')).map(([p, rest]) => [p, ...rest.slice(0, 2)]),
				{ minLength: 1, maxLength: 3 }
			)
			.map((items): Block => ({ t: 'list', items })),
		fc.tuple(fc.boolean(), tie('kids')).map(([open, kids]): Block => ({ t: 'details', open, kids }))
	),
	kids: fc.array(tie('block'), { minLength: 1, maxLength: 3 })
}));

const arbDoc = fc.record({
	blocks: fc.array(arbBlock, { minLength: 1, maxLength: 4 }),
	eol: fc.constantFrom('\n', '\r\n')
});

function linesOf(b: Block): string[] {
	switch (b.t) {
		case 'para':
			return [b.text];
		case 'quote':
			return stack(b.kids).map((l) => (l === '' ? '>' : `> ${l}`));
		case 'list':
			return b.items.flatMap(([first, ...rest]) => {
				const tail = rest.length > 0 ? ['', ...stack(rest)] : [];
				return [`- ${linesOf(first)[0]}`, ...tail.map((l) => (l === '' ? '' : `  ${l}`))];
			});
		case 'table': {
			const row = (cell: (c: number) => string) =>
				'| ' + Array.from({ length: b.cols }, (_, c) => cell(c)).join(' | ') + ' |';
			const body = Array.from({ length: b.rows }, (_, r) => row((c) => `c${r}${c}`));
			return [row((c) => `h${c}`), row(() => '-'), ...body];
		}
		case 'details':
			return [
				b.open ? '<details open>' : '<details>',
				'<summary>T</summary>',
				'',
				...stack(b.kids),
				'',
				'</details>'
			];
	}
}

function stack(blocks: Block[]): string[] {
	return blocks.flatMap((b, i) => (i > 0 ? ['', ...linesOf(b)] : linesOf(b)));
}

function sourceOf({ blocks, eol }: { blocks: Block[]; eol: string }): string {
	return stack(blocks).join(eol) + eol;
}

function openAll(b: Block): Block {
	if (b.t === 'details') return { ...b, open: true, kids: b.kids.map(openAll) };
	if (b.t === 'quote') return { ...b, kids: b.kids.map(openAll) };
	if (b.t === 'list') return { ...b, items: b.items.map((item) => item.map(openAll)) };
	return b;
}

// ── Checks ──────────────────────────────────────────────────────────────────

function isLeaf(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	return node !== null && path.length > 0 && !node.children?.length;
}

/** No ancestor of `path` is a collapsed container holding it past its title row. */
function mountedReachable(doc: Document, path: readonly number[]): boolean {
	for (let depth = 1; depth < path.length; depth++) {
		const container = nodeAt(doc, path.slice(0, depth));
		if (path[depth] >= 1 && container && isBlockNode(container)) {
			if (isCollapsedContainer(container)) return false;
		}
	}
	return true;
}

function caretLanding(doc: Document, path: number[] | null): boolean {
	return path !== null && isLeaf(doc, path) && mountedReachable(doc, path);
}

function allPaths(doc: Document): number[][] {
	const out: number[][] = [];
	const visit = (children: CstNode[] | undefined, prefix: number[]) =>
		children?.forEach((child, i) => {
			out.push([...prefix, i]);
			visit(child.children, [...prefix, i]);
		});
	visit(doc.children, []);
	return out;
}

/** Removes the block at `path`, and each container the removal leaves childless, as the commit's
 *  fix-up does; the root stays even when emptied. */
function removeWithEmptiedAncestors(doc: Document, path: number[]): Document {
	for (let at = path; at.length > 0; at = at.slice(0, -1)) {
		const parent = nodeAt(doc, at.slice(0, -1)) as Document | CstNode;
		parent.children!.splice(at[at.length - 1], 1);
		if (parent.children!.length > 0 || at.length === 1) break;
	}
	return doc;
}

function walk(start: number[] | null, step: (p: number[]) => number[] | null): number[][] {
	const seen: number[][] = [];
	for (let p = start; p; p = step(p)) seen.push(p);
	return seen;
}

function coverageBefore(doc: Document, from: number[]): number[] | null {
	let prev = previousPath(doc, from);
	while (prev && isStrictAncestorOf(prev, from)) prev = previousPath(doc, prev);
	return prev ? lastLeafAtOrBefore(doc, prev) : null;
}

function caretWalks(doc: Document): { forward: number[][]; backward: number[][] } {
	const last = doc.children.length - 1;
	return {
		forward: walk(firstCaretLeaf(doc, [0]), (p) => nextCaretPath(doc, p)),
		backward: walk(lastCaretLeaf(doc, [last]), (p) => previousCaretPath(doc, p))
	};
}

// ── Properties ──────────────────────────────────────────────────────────────

describe('caret-reachable order', () => {
	it('draws closed details inside open ones and open ones inside closed', () => {
		const shapes = fc.sample(arbDoc, { numRuns: 300, seed: 7 }).map((d) => parse(sourceOf(d)));
		const nested = (want: boolean) =>
			shapes.some((doc) =>
				allPaths(doc).some((p) => {
					const node = nodeAt(doc, p) as CstNode;
					const parent = nodeAt(doc, p.slice(0, -1));
					return (
						node.kind === 'details' &&
						parent !== null &&
						isBlockNode(parent) &&
						parent.kind === 'details' &&
						isCollapsedContainer(node) === want &&
						isCollapsedContainer(parent) !== want
					);
				})
			);
		expect(nested(true)).toBe(true);
		expect(nested(false)).toBe(true);
	});

	it('walks only leaves a mounted caret can reach, the same set in both directions', () => {
		fc.assert(
			fc.property(arbDoc, (d) => {
				const doc = parse(sourceOf(d));
				const { forward, backward } = caretWalks(doc);
				for (const p of forward) expect(caretLanding(doc, p), JSON.stringify(p)).toBe(true);
				expect(backward.slice().reverse()).toEqual(forward);
			}),
			PARAMS
		);
	});

	it('resolves every node path, hidden ones included, to a reachable leaf', () => {
		fc.assert(
			fc.property(arbDoc, (d) => {
				const doc = parse(sourceOf(d));
				for (const path of allPaths(doc)) {
					for (const offset of [0, CURSOR_START, CURSOR_END, FOCUS_LAST_START, 3]) {
						const t = caretTargetFor(doc, { path: docPathFrom(path), offset });
						expect(caretLanding(doc, t && [...t.leafPath]), `${path}@${offset}`).toBe(true);
					}
				}
			}),
			PARAMS
		);
	});

	it('picks a reachable survivor after any single block is removed', () => {
		fc.assert(
			fc.property(arbDoc, (d) => {
				const source = sourceOf(d);
				for (const path of allPaths(parse(source))) {
					const doc = removeWithEmptiedAncestors(parse(source), path);
					for (const side of ['before', 'after'] as const) {
						const s = survivorAfterRemoval(doc, path, side);
						const ok = s ? caretLanding(doc, [...s.path]) : doc.children.length === 0;
						expect(ok, `${path} ${side}`).toBe(true);
					}
				}
			}),
			PARAMS
		);
	});

	it('equals the coverage order when nothing is collapsed', () => {
		fc.assert(
			fc.property(arbDoc, (d) => {
				const doc = parse(sourceOf({ ...d, blocks: d.blocks.map(openAll) }));
				const { forward, backward } = caretWalks(doc);
				const coverage = walk(firstPath(doc), (p) => {
					const next = nextPath(doc, p);
					return next ? firstLeafAtOrAfter(doc, next) : null;
				});
				expect(forward).toEqual(coverage);
				expect(backward).toEqual(walk(lastPath(doc), (p) => coverageBefore(doc, p)));
			}),
			PARAMS
		);
	});
});

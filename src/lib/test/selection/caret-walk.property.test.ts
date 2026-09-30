// Every position the caret-reachable order hands out is a leaf a mounted caret can sit in: no
// ancestor is a collapsed container holding it in its hidden body. The generator mixes quotes,
// nested lists, tables and open or closed details nested in each other, empty leaves and
// summary-only details, non-ASCII text and both line endings; with every details open, the caret
// order equals the coverage order.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import type { CstNode, Document } from '../../core/nodes';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { displayLength } from '../../core/lines';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { isCollapsedContainer, isReservedChromeChild } from '../../schema/reserved-chrome';
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

beforeEach(registerChromePluginsForTests);

// ── Generator ───────────────────────────────────────────────────────────────

type Block =
	| { t: 'para'; text: string }
	| { t: 'quote'; kids: Block[] }
	| { t: 'list'; items: Block[][] }
	| { t: 'table'; rows: number; cols: number; emptyCell: boolean }
	| { t: 'details'; open: boolean; summary: string; kids: Block[] };

const WORDS = ['alpha', 'é', '😀x', 'é', 'Ω beta', '**b**'];
const arbPara = fc
	.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 })
	.map((w): Block => ({ t: 'para', text: w.join(' ') }));
const arbTable = fc
	.record({
		rows: fc.integer({ min: 1, max: 3 }),
		cols: fc.integer({ min: 2, max: 4 }),
		emptyCell: fc.boolean()
	})
	.map((r): Block => ({ t: 'table', ...r }));

const { block: arbBlock } = fc.letrec<{ block: Block; kids: Block[] }>((tie) => ({
	block: fc.oneof(
		{ maxDepth: 4, depthIdentifier: 'block' },
		arbPara,
		arbTable,
		fc.oneof(tie('kids'), fc.constant<Block[]>([])).map((kids): Block => ({ t: 'quote', kids })),
		fc
			.array(
				fc.tuple(arbPara, tie('kids')).map(([p, rest]) => [p, ...rest.slice(0, 2)]),
				{ minLength: 1, maxLength: 3 }
			)
			.map((items): Block => ({ t: 'list', items })),
		fc
			.tuple(
				fc.boolean(),
				fc.constantFrom('T', ''),
				fc.oneof(tie('kids'), fc.constant<Block[]>([]))
			)
			.map(([open, summary, kids]): Block => ({ t: 'details', open, summary, kids }))
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
			return b.kids.length > 0 ? stack(b.kids).map((l) => (l === '' ? '>' : `> ${l}`)) : ['>'];
		case 'list':
			return b.items.flatMap(([first, ...rest]) => {
				const tail = rest.length > 0 ? ['', ...stack(rest)] : [];
				return [`- ${linesOf(first)[0]}`, ...tail.map((l) => (l === '' ? '' : `  ${l}`))];
			});
		case 'table': {
			const row = (cell: (c: number) => string) =>
				'| ' + Array.from({ length: b.cols }, (_, c) => cell(c)).join(' | ') + ' |';
			const cell = (r: number, c: number) => (b.emptyCell && r + c === 0 ? '' : `c${r}${c}`);
			const body = Array.from({ length: b.rows }, (_, r) => row((c) => cell(r, c)));
			return [row((c) => `h${c}`), row(() => '-'), ...body];
		}
		case 'details': {
			const body = b.kids.length > 0 ? ['', ...stack(b.kids), ''] : [];
			const head = [b.open ? '<details open>' : '<details>', `<summary>${b.summary}</summary>`];
			return [...head, ...body, '</details>'];
		}
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

/** Every block path but a title row, which a container always keeps (G1.14). */
function removablePaths(doc: Document): number[][] {
	return allPaths(doc).filter((p) => {
		const parent = nodeAt(doc, p.slice(0, -1));
		return !(parent && isBlockNode(parent) && isReservedChromeChild(parent, p[p.length - 1]));
	});
}

function leafNode(doc: Document, path: number[] | null): CstNode | null {
	return path ? (nodeAt(doc, path) as CstNode) : null;
}

/** The first caret leaf after `path`'s whole subtree, read before anything is removed. */
function afterSubtree(doc: Document, path: number[]): number[] | null {
	const last = lastCaretLeaf(doc, path);
	return last ? nextCaretPath(doc, last) : null;
}

function pathOfNode(doc: Document, target: CstNode): number[] {
	const found = allPaths(doc).find((p) => nodeAt(doc, p) === target);
	if (!found) throw new Error('survivor node not in the tree');
	return found;
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

	it('draws summary-only details and empty leaves in a quote, a summary and a table cell', () => {
		const docs = fc.sample(arbDoc, { numRuns: 300, seed: 11 }).map((d) => parse(sourceOf(d)));
		const nodes = docs.flatMap((doc) =>
			allPaths(doc).map((p) => ({
				node: nodeAt(doc, p) as CstNode,
				parent: nodeAt(doc, p.slice(0, -1))
			}))
		);
		const emptyLeafUnder = (kind: string) =>
			nodes.some(
				({ node, parent }) =>
					!node.children?.length &&
					displayLength(node.raw) === 0 &&
					parent !== null &&
					isBlockNode(parent) &&
					parent.kind === kind
			);
		expect(nodes.some(({ node }) => node.kind === 'details' && node.children?.length === 1)).toBe(
			true
		);
		expect(emptyLeafUnder('details')).toBe(true);
		expect(emptyLeafUnder('blockquote')).toBe(true);
		expect(emptyLeafUnder('tableRow')).toBe(true);
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
					for (const offset of [0, CURSOR_START, CURSOR_EXACT_START, CURSOR_END, 3]) {
						const t = caretTargetFor(doc, { path: docPathFrom(path), offset });
						expect(caretLanding(doc, t && [...t.leafPath]), `${path}@${offset}`).toBe(true);
					}
				}
			}),
			PARAMS
		);
	});

	// The expected survivor is read before the removal, by node, so the check does not depend on
	// how the function reads the position the removal left.
	it('picks the reachable neighbour on the side asked after any single block is removed', () => {
		fc.assert(
			fc.property(arbDoc, (d) => {
				const source = sourceOf(d);
				for (const path of removablePaths(parse(source))) {
					const doc = parse(source);
					const before = leafNode(doc, previousCaretPath(doc, path));
					const after = leafNode(doc, afterSubtree(doc, path));
					removeWithEmptiedAncestors(doc, path);
					const atEnd = before && { path: pathOfNode(doc, before), offset: CURSOR_END };
					const atStart = after && { path: pathOfNode(doc, after), offset: CURSOR_START };
					const want = {
						before: atEnd ?? atStart ?? null,
						after: atStart ?? atEnd ?? null
					};
					const gestures = { before: 'Backspace', after: 'Delete' } as const;
					for (const side of ['before', 'after'] as const) {
						const s = survivorAfterRemoval(doc, path, gestures[side]);
						expect(s && { path: [...s.path], offset: s.offset }, `${path} ${side}`).toEqual(
							want[side]
						);
						if (s) expect(caretLanding(doc, [...s.path]), `${path} ${side}`).toBe(true);
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

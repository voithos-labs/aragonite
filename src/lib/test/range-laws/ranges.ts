// Where a range's ends go: drawn as seeds, then resolved against the document the editor opened,
// so a shrink moves an end along real positions and every end names a block that exists.

import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import { getContentRange } from '#lib/index.js';

/** One end, before it meets a document: which site, and where in it. */
export interface EndSeed {
	site: number;
	at: 'start' | 'end' | 'inside';
	inside: number;
}

export const arbEnd: fc.Arbitrary<EndSeed> = fc.record({
	site: fc.nat({ max: 63 }),
	at: fc.constantFrom<EndSeed['at']>('start', 'end', 'start', 'end', 'inside'),
	inside: fc.nat({ max: 63 })
});

/** A range is two ends; a caret is one. */
export const arbRangeSeed = fc.record({ a: arbEnd, b: arbEnd });
export type RangeSeed = { a: EndSeed; b: EndSeed };

/** A block a caret or a range end can sit in: a leaf by its text, or a table by its cells. */
export interface Site {
	path: number[];
	kind: string;
	/** Text offsets run `start..end`; a table's run over its cells, row-major. */
	start: number;
	end: number;
	cells: boolean;
	raw: string;
}

export function sitesOf(doc: Document): Site[] {
	const sites: Site[] = [];
	const visit = (nodes: readonly CstNode[], prefix: number[]) =>
		nodes.forEach((node, i) => {
			const path = [...prefix, i];
			if (node.kind === 'table') {
				const cells = (node.children ?? []).flatMap((row) => row.children ?? []).length;
				sites.push({ path, kind: node.kind, start: 0, end: cells, cells: true, raw: node.raw });
			} else if (node.children && node.children.length > 0) visit(node.children, path);
			else {
				const end = node.raw.replace(/\r?\n$/, '').length;
				const start = Math.min(getContentRange(node).start, end);
				sites.push({ path, kind: node.kind, start, end, cells: false, raw: node.raw });
			}
		});
	visit(doc.children, []);
	return sites;
}

function offsetIn(site: Site, seed: EndSeed): number {
	if (seed.at === 'start' || site.end === site.start) return site.start;
	if (seed.at === 'end') return site.end;
	return onCharBoundary(site, site.start + 1 + (seed.inside % Math.max(1, site.end - site.start)));
}

/** Back off an offset that would split a surrogate pair or a CRLF. */
function onCharBoundary(site: Site, offset: number): number {
	const at = Math.min(offset, site.end);
	const before = site.raw.charCodeAt(at - 1);
	if (before >= 0xd800 && before <= 0xdbff) return at - 1;
	if (site.raw[at - 1] === '\r' && site.raw[at] === '\n') return at - 1;
	return at;
}

function pointAt(site: Site, offset: number): SelectionPoint {
	return site.cells
		? { path: site.path, offset, cellCoordinate: true }
		: { path: site.path, offset };
}

/** `seed` read against `doc`, in document order; null when it names no range there. */
export function resolveRange(doc: Document, seed: RangeSeed): EditorSelection | null {
	const sites = sitesOf(doc);
	if (sites.length === 0) return null;
	const first = sites[seed.a.site % sites.length];
	const second = sites[seed.b.site % sites.length];
	let a = offsetIn(first, seed.a);
	let b = offsetIn(second, seed.b);
	if (first === second) {
		if (first.cells) return null;
		if (a === b) [a, b] = [first.start, first.end];
		if (a === b) return null;
		if (a > b) [a, b] = [b, a];
		return { anchor: pointAt(first, a), focus: pointAt(first, b) };
	}
	const [from, to] =
		sites.indexOf(first) < sites.indexOf(second)
			? [pointAt(first, a), pointAt(second, b)]
			: [pointAt(second, b), pointAt(first, a)];
	return { anchor: from, focus: to };
}

/** A caret at one end's position, in a block with text. */
export function resolveCaret(doc: Document, seed: EndSeed): EditorSelection | null {
	const sites = sitesOf(doc).filter((site) => !site.cells);
	if (sites.length === 0) return null;
	const site = sites[seed.site % sites.length];
	const point = pointAt(site, offsetIn(site, seed));
	return { anchor: point, focus: point };
}

// ── Shape labels ─────────────────────────────────────────────────────────────

/** Which containers a range sits in, enters and leaves, read so a report groups like with like:
 *  `common | start chain → end chain`, e.g. `document | paragraph → blockquote>paragraph`. */
export function shapeOf(doc: Document, range: EditorSelection): string {
	const { anchor, focus } = range;
	let common = 0;
	const shorter = Math.min(anchor.path.length, focus.path.length);
	while (common < shorter - 1 && anchor.path[common] === focus.path[common]) common++;
	const holder = kindsAlong(doc, anchor.path.slice(0, common)).at(-1) ?? 'document';
	const chain = (path: number[]) => kindsAlong(doc, path).slice(common).join('>');
	if (anchor.path.join() === focus.path.join()) return `${holder} | ${chain(anchor.path)}`;
	return `${holder} | ${chain(anchor.path)} → ${chain(focus.path)}`;
}

function kindsAlong(doc: Document, path: readonly number[]): string[] {
	const kinds: string[] = [];
	let nodes: readonly CstNode[] = doc.children;
	for (const index of path) {
		const node = nodes[index];
		if (!node) break;
		kinds.push(node.kind);
		nodes = node.children ?? [];
	}
	return kinds;
}

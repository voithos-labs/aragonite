/**
 * Whether two blocks an edit leaves touching keep a blank line between them: the fix-up's join
 * question (`RangeHost.parts`), asked by a removal and by a paste of the pair each leaves touching.
 * The core adds a blank line to keep two readings nowhere else.
 */

import { contentEnd, nodeAt, type Doc } from './document';
import type { JoinSide } from './host';
import type { LaidBlock } from './layout';
import { lineRest } from './leaf-splice';
import { continuation } from './markers';

/** A block the edit rewrote, with its bytes after the write; a kind it may have lost is read. */
interface Rewritten {
	block: LaidBlock;
	raw: string;
	kind?: string;
}

/** The join an edit over `[from, to)` leaves: the block the upper side ends in and the one the
 *  lower side starts in, read before the edit, and the blocks it rewrote. */
export interface Join {
	from: number;
	to: number;
	upper: LaidBlock | undefined;
	lower: LaidBlock | undefined;
	rewritten: { upper?: Rewritten; lower?: Rewritten };
}

interface Pair {
	parent: number[];
	index: number;
	upper: JoinSide;
	lower: JoinSide;
	/** The lower side's block under the parent, laid out before the edit. */
	below: LaidBlock;
}

/** `out` with a blank line opening at `at`, where the lower block's line starts, when the pair
 *  `join` leaves touching there would read as something else flush. */
export function apartAt(doc: Doc, out: string, at: number, join: Join, placed: boolean): string {
	if (at === 0) return out;
	const line = lineRest(out, at);
	const lineAbove = out.slice(out.lastIndexOf('\n', at - 2) + 1, at - 1).replace(/\r$/, '');
	// A blank line parts them already.
	const containers = holdingBoth(doc, join);
	if (doc.host.blankIn(containers, line) || doc.host.blankIn(containers, lineAbove)) return out;
	const pair = siblingsAt(doc, join, out, at);
	const stood = pair?.below.path.at(-1) ?? null;
	if (
		!pair ||
		!doc.host.parts(doc.tree, pair.parent, pair.index, pair.upper, pair.lower, placed, stood)
	)
		return out;
	const run = line.slice(0, doc.host.pastMarkers(line, 0));
	// The markers of the containers holding both, never the lower block's own, which would take the
	// blank line into it; a line whose text the upper side still opens keeps its own.
	const holding = (c: LaidBlock) => c.path.length <= pair.parent.length;
	const marks = at + run.length < join.from ? run : continuation(doc, pair.below.from, holding);
	return out.slice(0, at) + marks.trimEnd() + doc.ending + out.slice(at);
}

/** The kinds of the containers holding both sides of `join`, outermost first. */
function holdingBoth(doc: Doc, join: Join): string[] {
	const { upper, lower } = join;
	const depth = upper && lower ? sharedDepth(upper.path, lower.path) : 0;
	return Array.from(
		{ length: depth },
		(_, i) => doc.layout.block(upper!.path.slice(0, i + 1))!.type
	);
}

function sharedDepth(a: readonly number[], b: readonly number[]): number {
	let k = 0;
	while (k < a.length && k < b.length && a[k] === b[k]) k++;
	return k;
}

/** The innermost block whose own bytes hold `byte`. */
export function deepestAt(doc: Doc, byte: number): LaidBlock | undefined {
	let found: LaidBlock | undefined;
	for (const block of doc.layout.within(byte, byte))
		if (block.from <= byte && byte < block.to) found = block;
	return found;
}

/** The siblings `join` leaves touching in `out`, the lower one's line starting at `at`, under the
 *  nearest parent holding both sides; null where a lower side changed inside a container. */
function siblingsAt(doc: Doc, join: Join, out: string, at: number): Pair | null {
	const { from, to, upper, lower, rewritten } = join;
	if (!upper || !lower) return null;
	const k = sharedDepth(upper.path, lower.path);
	if (k >= upper.path.length || k >= lower.path.length) return null;
	const side = (block: LaidBlock, written: Rewritten | undefined, untouched: boolean) => {
		if (written && written.block.path.join() === block.path.join()) return written;
		return untouched ? nodeAt(doc, block.path) : null;
	};
	const above = doc.layout.block(upper.path.slice(0, k + 1))!;
	const below = doc.layout.block(lower.path.slice(0, k + 1))!;
	// An upper side the removal changed reads off its new bytes, up to the lower one's line.
	const changed = () => {
		const raw = ownBytes(doc, above, out, Math.min(from, at), at);
		return raw === null ? null : { ...nodeAt(doc, above.path), raw };
	};
	const up = side(above, rewritten.upper, contentEnd(doc, above) <= from) ?? changed();
	// A top-level lower side the removal changed reads off its new bytes from its line on; every
	// byte the removal changed sits before its end.
	const shift = out.length - doc.source.length;
	const down =
		side(below, rewritten.lower, below.from >= to) ??
		(k === 0 ? { ...nodeAt(doc, below.path), raw: out.slice(at, below.to + shift) } : null);
	return up && down
		? { parent: upper.path.slice(0, k), index: upper.path[k], upper: up, lower: down, below }
		: null;
}

/** `out` from `block`'s start to `at`, its parent's markers off each unchanged line (those starting
 *  by `last`), where a list's lines carry none; null under a table row, whose cells share a line. */
function ownBytes(
	doc: Doc,
	block: LaidBlock,
	out: string,
	last: number,
	at: number
): string | null {
	const parent = block.path.length > 1 ? doc.layout.block(block.path.slice(0, -1)) : undefined;
	if (!parent) return out.slice(block.from, at);
	if (!parent.linesIn) return null;
	let raw = '';
	for (const line of parent.linesIn(block.from, last)) {
		if (line.to <= block.from || line.from > last) continue;
		const end = out.indexOf('\n', line.from) + 1 || out.length;
		raw += out.slice(Math.max(line.markerTo, block.from), Math.min(end, at));
	}
	return raw;
}

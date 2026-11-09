/**
 * What paints over one block, split by what reads it: the mark overlay, the inline widget pass and
 * the block's own classes. A part equal to the one a block held is kept as that same array, so a
 * reader whose part didn't change is never told.
 */
import type { NodeView } from '../core/node-views';
import type { IndexedDecoration } from './buckets';
import { islandPosition } from './island-dom';
import type {
	BlockDecoration,
	Decoration,
	MarkDecoration,
	ReplaceDecoration,
	WidgetDecoration
} from './types';

export interface PaintParts {
	/** In precedence order; `index` is the mark's place in it. */
	readonly marks: readonly IndexedDecoration<MarkDecoration>[];
	/** Sorted by position, the order the widget pass applies them in. */
	readonly islands: readonly IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	readonly blocks: readonly BlockDecoration[];
}

export const NO_PAINT: PaintParts = Object.freeze({ marks: [], islands: [], blocks: [] });

/** Paint asked for one block at a time, which the engine lays after the whole-document input. */
export interface BlockSource {
	/** Names the source in a hover's identity. */
	readonly name: string;
	/** `node`'s decorations at `path`, for a reactive read: the same array until they change. */
	decorationsOf(node: NodeView, path: readonly number[]): readonly Decoration[];
}

/** One block's decorations, in precedence order, split into the three parts. */
export function splitBucket(decs: readonly Decoration[]): PaintParts {
	const marks: IndexedDecoration<MarkDecoration>[] = [];
	const islands: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
	const blocks: BlockDecoration[] = [];
	decs.forEach((dec, index) => {
		if (dec.type === 'mark') marks.push({ dec, index: marks.length });
		else if (dec.type === 'block') blocks.push(dec);
		else islands.push({ dec, index });
	});
	islands.sort((a, b) => islandPosition(a.dec) - islandPosition(b.dec));
	return { marks, islands, blocks };
}

/** `base` with `decs` laid after it, split as one list would be. */
export function withDecorations(base: PaintParts, decs: readonly Decoration[]): PaintParts {
	const islands = [...base.islands].sort((a, b) => a.index - b.index).map((i) => i.dec);
	return splitBucket([...base.marks.map((m) => m.dec), ...islands, ...base.blocks, ...decs]);
}

/** `next`, with each part equal to `held`'s replaced by `held`'s own array, and `held` itself when
 *  every part is. A widget or a badge is never equal: its view is told each new decoration. */
export function keepEqualParts(held: PaintParts, next: PaintParts): PaintParts {
	const marks = sameList(held.marks, next.marks, (a, b) => sameDecoration(a.dec, b.dec))
		? held.marks
		: next.marks;
	const blocks = sameList(held.blocks, next.blocks, sameDecoration) ? held.blocks : next.blocks;
	const islands =
		held.islands.length === 0 && next.islands.length === 0 ? held.islands : next.islands;
	if (marks === held.marks && blocks === held.blocks && islands === held.islands) return held;
	return { marks, islands, blocks };
}

/** Equal fields, with handlers and views compared by identity. */
export function sameDecoration(a: Decoration, b: Decoration): boolean {
	if (a === b) return true;
	if (!samePath(a.path, b.path)) return false;
	if (a.type === 'mark' && b.type === 'mark') {
		return (
			a.start === b.start &&
			a.end === b.end &&
			a.class === b.class &&
			sameAttrs(a.attrs, b.attrs) &&
			a.interactive?.onClick === b.interactive?.onClick &&
			a.interactive?.onHover === b.interactive?.onHover &&
			a.interactive?.onActivate === b.interactive?.onActivate
		);
	}
	if (a.type === 'block' && b.type === 'block') {
		return !a.badge && !b.badge && a.class === b.class && sameAttrs(a.attrs, b.attrs);
	}
	return false;
}

// A kept decoration names its block's path now, which an insert above it moves.
function samePath(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((step, i) => step === b[i]);
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
	return a.length === b.length && a.every((x, i) => same(x, b[i]));
}

function sameAttrs(
	a: Readonly<Record<string, string>> | undefined,
	b: Readonly<Record<string, string>> | undefined
): boolean {
	if (a === b) return true;
	const keys = Object.keys(a ?? {});
	return keys.length === Object.keys(b ?? {}).length && keys.every((k) => a?.[k] === b?.[k]);
}

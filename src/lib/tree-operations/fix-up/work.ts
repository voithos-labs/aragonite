// The list being fixed up: its blocks, the block of the list as given each continues, its trailing
// blank lines, and the positions that must follow every change.
import { trimTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import { spliceMany } from '../splice-many';
import type { SiblingList, Caret, ListResult } from './types';

export type Mark = 'caret' | 'writtenStart' | 'movedTo';

export interface Work {
	readonly list: SiblingList;
	readonly blocks: Blocks;
	/** A container's blank lines above its body (`innerPrefix`). */
	leading: string;
	trailing: string;
	marks: Partial<Record<Mark, Caret>>;
}

/**
 * The list as given with one window of it replaced. Reads outside the window go to the given list
 * and every write widens the window, so a fix-up costs what it touches, never the list's length.
 */
export class Blocks {
	private lo = 0;
	private taken = 0;
	private mid: CstNode[] = [];
	private origins: number[] = [];

	constructor(private readonly given: readonly CstNode[]) {}

	get length(): number {
		return this.given.length - this.taken + this.mid.length;
	}

	/** Block `i`, read like an array: past either end it is undefined. */
	at(i: number): CstNode {
		if (i < this.lo) return this.given[i];
		return i - this.lo < this.mid.length ? this.mid[i - this.lo] : this.given[this.givenIndex(i)];
	}

	/** The position in the list as given whose block `i` continues, or -1. */
	origin(i: number): number {
		if (i < this.lo) return i;
		return i - this.lo < this.mid.length ? this.origins[i - this.lo] : this.givenIndex(i);
	}

	slice(from: number, to: number = this.length): CstNode[] {
		const out: CstNode[] = [];
		for (let i = Math.max(from, 0); i < Math.min(to, this.length); i++) out.push(this.at(i));
		return out;
	}

	set(i: number, node: CstNode): void {
		this.splice(i, 1, [node], [this.origin(i)]);
	}

	push(node: CstNode): void {
		this.splice(this.length, 0, [node], [-1]);
	}

	splice(at: number, removed: number, add: readonly CstNode[], origins: readonly number[]): void {
		this.cover(at, at + removed);
		const k = at - this.lo;
		spliceMany(this.mid, k, removed, add);
		spliceMany(this.origins, k, removed, origins);
	}

	/** The window that differs from the list as given, its unchanged edges left out. */
	window(): Pick<ListResult, 'at' | 'removed' | 'blocks' | 'keeps'> {
		let start = 0;
		let end = this.mid.length;
		const same = (k: number, g: number) => this.mid[k] === this.given[g] && this.origins[k] === g;
		while (start < end && start < this.taken && same(start, this.lo + start)) start++;
		const tail = (k: number) => this.lo + this.taken - (this.mid.length - k);
		while (
			end > start &&
			this.mid.length - end < this.taken - start &&
			same(end - 1, tail(end - 1))
		)
			end--;
		const removed = this.taken - start - (this.mid.length - end);
		return {
			at: this.lo + start,
			removed,
			blocks: this.mid.slice(start, end),
			keeps: this.origins.slice(start, end)
		};
	}

	private givenIndex(i: number): number {
		return i - this.mid.length + this.taken;
	}

	/** Widens the window over `[from, to)` of the list as it stands. */
	private cover(from: number, to: number): void {
		if (this.mid.length === 0 && this.taken === 0) this.lo = from;
		for (; this.lo > from; this.taken++) {
			this.lo--;
			this.mid.unshift(this.given[this.lo]);
			this.origins.unshift(this.lo);
		}
		for (; this.lo + this.mid.length < to; this.taken++) {
			const g = this.lo + this.taken;
			this.mid.push(this.given[g]);
			this.origins.push(g);
		}
	}
}

export function startWork(list: SiblingList, marks: Work['marks']): Work {
	const trailing = list.suffix ?? list.owner?.innerSuffix ?? '';
	const leading = list.owner?.innerPrefix ?? '';
	return { list, blocks: new Blocks(list.children), leading, trailing, marks };
}

const span = (node: CstNode) => node.leadingTrivia.length + node.raw.length;

/** Byte offsets of each block's `raw` from the start of `blocks[0]`'s blank lines. */
function rawStarts(blocks: readonly CstNode[]): number[] {
	let at = 0;
	return blocks.map((node) => {
		const start = at + node.leadingTrivia.length;
		at += span(node);
		return start;
	});
}

/** Replaces `blocks[lo, hi]` with `next`, which holds the same bytes; the first block continues the
 *  topmost, and a mark lands on the same byte (at the next block's start when that byte is a gap). */
export function replace(work: Work, lo: number, hi: number, next: CstNode[]): void {
	const old = work.blocks.slice(lo, hi + 1);
	const oldStarts = rawStarts(old);
	const newStarts = rawStarts(next);
	const origins = next.map((_, k) => (k === 0 ? work.blocks.origin(lo) : -1));
	const atEnd = hi === work.blocks.length - 1;
	for (const [name, mark] of Object.entries(work.marks) as [Mark, Caret][]) {
		if (mark.index > hi)
			work.marks[name] = { index: mark.index - old.length + next.length, offset: mark.offset };
		if (mark.index >= lo && mark.index <= hi)
			work.marks[name] = landing(
				next,
				newStarts,
				oldStarts[mark.index - lo] + mark.offset,
				lo,
				atEnd
			);
	}
	work.blocks.splice(lo, hi - lo + 1, next, origins);
}

function landing(
	blocks: CstNode[],
	starts: number[],
	at: number,
	base: number,
	atEnd: boolean
): Caret {
	for (let i = 0; i < blocks.length; i++) {
		if (at < starts[i]) return { index: base + i, offset: 0 };
		if (at <= starts[i] + trimTrailingLineEnding(blocks[i].raw).length)
			return { index: base + i, offset: at - starts[i] };
	}
	const last = blocks.length - 1;
	if (!atEnd) return { index: base + blocks.length, offset: 0 };
	return { index: base + last, offset: trimTrailingLineEnding(blocks[last].raw).length };
}

/** The window of `work` that differs from the list as given, as a result. */
export function finish(work: Work): ListResult {
	const { blocks } = work;
	const trailing = work.list.owner
		? { innerPrefix: work.leading, innerSuffix: work.trailing }
		: { suffix: work.trailing };
	const marks = Object.entries(work.marks).map(([name, mark]) => {
		if (name === 'movedTo') return [name, mark.index];
		// A written block left empty starts where the block touching it below does.
		const next = blocks.at(mark.index + 1);
		const atEnd = mark.offset === blocks.at(mark.index)?.raw.length && next?.leadingTrivia === '';
		return [name, name === 'writtenStart' && atEnd ? { index: mark.index + 1, offset: 0 } : mark];
	});
	return { ...blocks.window(), ...trailing, ...Object.fromEntries(marks) };
}

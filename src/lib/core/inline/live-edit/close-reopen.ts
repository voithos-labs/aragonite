/**
 * How a live cut through a format run keeps the run on both halves (`docs/design/live-mode.md`
 * § 4.4, § 4.5): the half before the cut closes it, the half after reopens it, and a half that
 * keeps none of the run's content takes none of its delimiters. Enter, a pending mark's escape
 * and every live removal share this.
 */

import type { AnyInlineKind } from '../../nodes';
import {
	getInlineConstructPolicy,
	getInlineMarkPolicy
} from '../../../schema/inline-construct-policy';

/** Whether a cut through `kind` closes it on the half before and reopens it on the half after. */
export function closesAndReopens(kind: AnyInlineKind): boolean {
	return getInlineConstructPolicy(kind)?.splitBehavior === 'close-and-reopen';
}

/** A construct a cut passes through, in its block's raw coordinates. */
export interface CutConstruct {
	kind: AnyInlineKind;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

export interface ClosedHalf<T extends CutConstruct> {
	/** Where the kept bytes end: the cut, or earlier where a construct kept nothing and its
	 *  opener went with it. */
	end: number;
	/** The closers to write at `end`, innermost first. */
	closers: string;
	closed: T[];
}

export interface ReopenedHalf<T extends CutConstruct> {
	/** Where the kept bytes start: the cut, or later where a construct kept nothing and its
	 *  closer went with it. */
	start: number;
	/** The openers to write at `start`, outermost first. */
	openers: string;
	reopened: T[];
}

/** The half of `raw` before `cut`, with `chain` (outermost first) closed there. */
export function closeBefore<T extends CutConstruct>(
	raw: string,
	chain: readonly T[],
	cut: number
): ClosedHalf<T> {
	let end = cut;
	let closers = '';
	const closed: T[] = [];
	for (const link of [...chain].reverse()) {
		if (end === link.contentStart) end = link.start;
		else {
			closers += raw.slice(link.contentEnd, link.end);
			closed.push(link);
		}
	}
	return { end, closers, closed };
}

/** The half of `raw` from `cut`, with `chain` (outermost first) reopened there. */
export function reopenAfter<T extends CutConstruct>(
	raw: string,
	chain: readonly T[],
	cut: number
): ReopenedHalf<T> {
	let start = cut;
	let openers = '';
	const reopened: T[] = [];
	for (const link of [...chain].reverse()) {
		if (start === link.contentEnd) start = link.end;
		else {
			openers = raw.slice(link.start, link.contentStart) + openers;
			reopened.push(link);
		}
	}
	return { start, openers, reopened };
}

/** The marker a format chord writes for `kind`, which closes mid-word where `__` can't. Null where
 *  a run's own bytes are its only spelling (a link's destination, a code span's sized fence). */
export function markSpelling(kind: AnyInlineKind): string | null {
	const mark = getInlineMarkPolicy(kind);
	return mark && !mark.wrapBytes ? mark.markerBytes : null;
}

/** The delimiters of `c`, a construct of `raw`, in its chord's marker; its own bytes where it has none. */
export function chordSpelling(raw: string, c: CutConstruct): { opener: string; closer: string } {
	const marker = markSpelling(c.kind);
	return marker === null
		? { opener: raw.slice(c.start, c.contentStart), closer: raw.slice(c.contentEnd, c.end) }
		: { opener: marker, closer: marker };
}

// Emphasis, strong emphasis, strikethrough and plugin mark pairing: commonmark.js's delimiter
// algorithm over a linked list, with its per-kind lower bounds so unmatched closers stay linear.
import type { AnyInlineKind, InlineNode } from '../../nodes';
import { closeWrapper, openWrapper, type Token } from './token';

export interface Delimiter {
	token: Token;
	char: string;
	/** Run length as written, for the rule of three. */
	length: number;
	/** Delimiters not yet consumed. */
	count: number;
	canOpen: boolean;
	canClose: boolean;
	/** A plugin mark's kind: its runs pair as `~`'s do, at equal length. */
	kind?: AnyInlineKind;
	previous: Delimiter | null;
	next: Delimiter | null;
}

export class DelimiterStack {
	top: Delimiter | null = null;

	push(d: Omit<Delimiter, 'previous' | 'next'>): void {
		const entry: Delimiter = { ...d, previous: this.top, next: null };
		if (this.top) this.top.next = entry;
		this.top = entry;
	}

	remove(d: Delimiter): void {
		if (d.previous) d.previous.next = d.next;
		if (d.next) d.next.previous = d.previous;
		else this.top = d.previous;
	}

	/** Pairs every delimiter above `bottom`, then drops them all. */
	process(bottom: Delimiter | null): void {
		const openersBottom = new Map<string, Delimiter | null>();
		let closer = this.top === bottom ? null : this.top;
		while (closer && closer.previous !== bottom) closer = closer.previous;
		while (closer) {
			if (!closer.canClose) {
				closer = closer.next;
				continue;
			}
			const key = pairsExactly(closer)
				? `${closer.char}${closer.length}`
				: `${closer.char}${+closer.canOpen}${closer.length % 3}`;
			const floor = openersBottom.has(key) ? openersBottom.get(key) : bottom;
			let opener = closer.previous;
			while (opener && opener !== bottom && opener !== floor && !pairs(opener, closer))
				opener = opener.previous;
			if (opener && opener !== bottom && opener !== floor) {
				closer = this.pair(opener, closer);
			} else {
				openersBottom.set(key, closer.previous);
				const next = closer.next;
				if (!closer.canOpen) this.remove(closer);
				closer = next;
			}
		}
		while (this.top && this.top !== bottom) this.remove(this.top);
	}

	/** Wraps the bytes between the two runs; returns the closer to look at next. */
	private pair(opener: Delimiter, closer: Delimiter): Delimiter | null {
		const exact = pairsExactly(closer);
		const use = exact ? closer.count : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
		opener.token.litEnd -= use;
		closer.token.litStart += use;
		const kind = closer.kind ?? (exact ? 'strikethrough' : use === 1 ? 'emphasis' : 'strong');
		const wrapper: InlineNode = {
			kind,
			start: opener.token.litEnd,
			end: closer.token.litStart,
			children: []
		};
		openWrapper(opener.token, wrapper);
		closeWrapper(closer.token);
		opener.count -= use;
		closer.count -= use;
		opener.next = closer;
		closer.previous = opener;
		if (opener.count === 0) this.remove(opener);
		if (closer.count > 0) return closer;
		this.remove(closer);
		return closer.next;
	}
}

function pairs(opener: Delimiter, closer: Delimiter): boolean {
	if (opener.char !== closer.char || !opener.canOpen) return false;
	if (pairsExactly(closer)) return opener.length === closer.length;
	const oddMatch =
		(closer.canOpen || opener.canClose) &&
		closer.length % 3 !== 0 &&
		(opener.length + closer.length) % 3 === 0;
	return !oddMatch;
}

const pairsExactly = (d: Delimiter): boolean => d.char === '~' || d.kind !== undefined;

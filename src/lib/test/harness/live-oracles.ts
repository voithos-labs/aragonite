/**
 * The byte-level oracles live-mode.md § 2's license is checked with: what a rewrite may drop, and
 * the residue § 4.1 forbids it from minting. Shared by the split and join property nets and the
 * gesture fuzzer, so one reading of the license answers for all three.
 */

/**
 * The residue § 4.4 names: a symmetric emphasis pair with nothing between it. Two shapes are
 * deliberately NOT counted, both measured: `[]()`, whose emptied text is `autoUnwrapOnEmpty`'s
 * business, and a backtick run, which the literal and live arms spell at different lengths so the
 * count would report the shorter one as the offender.
 */
const EMPTY_PAIR = /\*\*\*\*|~~~~|(?<![\w_])____(?![\w_])/g;

/** Where each residue run sits, for a caller that also has to ask whether those bytes PAINT. */
export const emptyPairSpans = (bytes: string): { start: number; end: number }[] =>
	[...bytes.matchAll(EMPTY_PAIR)].map((m) => ({ start: m.index, end: m.index + m[0].length }));

export const countEmptyPairs = (bytes: string): number => emptyPairSpans(bytes).length;

/**
 * Whether `inner` can be read off `outer` by deleting characters — the shape of a rewrite that only
 * ever drops runs from the bytes it was handed. Code UNITS, not code points: an offset is a
 * code-unit index everywhere in the editor, so a lone surrogate is a byte like any other here.
 */
export function isSubsequence(inner: string, outer: string): boolean {
	let at = 0;
	for (let i = 0; i < outer.length; i++) {
		if (at < inner.length && inner.charCodeAt(at) === outer.charCodeAt(i)) at++;
	}
	return at === inner.length;
}

/** Every non-line-ending byte of `before` still present in `after`, as a multiset over code units.
 *  Relaxed from equality because closing and reopening a construct DUPLICATES its delimiter run. */
export function keepsEveryByte(before: string, after: string): boolean {
	// The declared-drop exception (#106), re-derived: the rebalancer strips `droppedTail` before
	// returning its halves, so the forgiveness is bounded by the line-terminal whitespace `before`
	// holds — exact position would make this net an echo of the verifier, not an oracle.
	let droppable = (before.match(/[ \t]+(?=\r?\n|$)/g) ?? []).join('').length;
	const budget = new Map<string, number>();
	for (const byte of after.replace(/\r?\n/g, '').split('')) {
		budget.set(byte, (budget.get(byte) ?? 0) + 1);
	}
	for (const byte of before.replace(/\r?\n/g, '').split('')) {
		const left = budget.get(byte) ?? 0;
		if (left === 0) {
			if (byte.trim() === '' && droppable > 0) {
				droppable--;
				continue;
			}
			return false;
		}
		budget.set(byte, left - 1);
	}
	return true;
}

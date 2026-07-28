import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// The suite's marquee guarantee — serialize(parse(source)) === source — is pinned
// by ~two dozen table loops across the parser, plugin, and invariant suites. This
// is their shared driver; the loops become fixture tables. A bare-string case names
// itself with its JSON-escaped source; a labelled case names itself by its label.

export type RoundTripCase = string | { name: string; source: string };

function caseName(c: RoundTripCase): string {
	return typeof c === 'string' ? `round-trips ${JSON.stringify(c)}` : `round-trips: ${c.name}`;
}

/** One `it` per case asserting a byte-for-byte round-trip. Call inside a describe. */
export function roundTripCases(cases: RoundTripCase[]): void {
	for (const c of cases) {
		const source = typeof c === 'string' ? c : c.source;
		it(caseName(c), () => {
			expect(serialize(parse(source))).toBe(source);
		});
	}
}

/** `roundTripCases` in its own `describe(title)` — the drop-in for a loop that owns one. */
export function describeRoundTrips(title: string, cases: RoundTripCase[]): void {
	describe(title, () => {
		roundTripCases(cases);
	});
}

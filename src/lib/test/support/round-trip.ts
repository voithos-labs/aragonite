import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// Shared driver for the round-trip guarantee (serialize(parse(source)) === source),
// so the table loops pinning it across the parser, plugin, and invariant suites
// stay fixture tables rather than copies of the assertion.

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

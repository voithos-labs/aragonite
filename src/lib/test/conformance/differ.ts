/**
 * Compares an inline parser (the shipping pipeline by default, or an injected
 * one — the pre-cutover scanner rides through here) against the commonmark
 * reference over a corpus. No try/catch anywhere: a normalizer throw means an
 * unmapped node type — a harness bug that must surface, never be counted as a
 * divergence or a skip.
 */
import { parseInline } from '../../core/inline';
import type { LinkReferenceResolver } from '../../core/inline/link-reference-resolver';
import type { InlineNode } from '../../core/nodes';
import { referenceInlineReading, type ReferenceSkip } from './reference';
import { normalizeAragonite, normalizeReference, normalEqual, type NormalNode } from './normalize';

export type InlineParser = (
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver
) => InlineNode[];

export interface Divergence {
	input: string;
	ours: NormalNode[];
	theirs: NormalNode[];
}

export function diffInput(input: string, parser: InlineParser = parseInline): Divergence | null {
	const outcome = evaluateInput(input, parser);
	return typeof outcome === 'string' ? null : outcome;
}

export function runDiff(
	inputs: string[],
	parser: InlineParser = parseInline
): {
	divergences: Divergence[];
	skipped: number;
	skippedNotParagraph: number;
	skippedPartialSpan: number;
	compared: number;
} {
	const divergences: Divergence[] = [];
	let skippedNotParagraph = 0;
	let skippedPartialSpan = 0;
	let compared = 0;
	for (const input of inputs) {
		const outcome = evaluateInput(input, parser);
		if (outcome === 'not-single-paragraph') {
			skippedNotParagraph++;
			continue;
		}
		if (outcome === 'partial-span') {
			skippedPartialSpan++;
			continue;
		}
		compared++;
		if (outcome !== 'equal') divergences.push(outcome);
	}
	return {
		divergences,
		skipped: skippedNotParagraph + skippedPartialSpan,
		skippedNotParagraph,
		skippedPartialSpan,
		compared
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

function evaluateInput(input: string, parser: InlineParser): ReferenceSkip | 'equal' | Divergence {
	const reading = referenceInlineReading(input);
	if ('skip' in reading) return reading.skip;
	const theirs = normalizeReference(reading.nodes);
	// No resolver, deliberately: the reference wrapper skips every input whose
	// parse consumed a refmap entry (reference.ts span guard), so a resolver
	// would never fire — unresolvedReference deviations are invisible here by design.
	const ours = normalizeAragonite(parser(input, 0, input.length), input);
	return normalEqual(ours, theirs) ? 'equal' : { input, ours, theirs };
}

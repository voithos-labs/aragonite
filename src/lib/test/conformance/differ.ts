/**
 * Compares our inline parser against the commonmark reference over a corpus.
 * No try/catch anywhere: a normalizer throw means an unmapped node type — a
 * harness bug that must surface, never be counted as a divergence or a skip.
 */
import { parseInline } from '../../core/inline';
import { referenceInlineNodes } from './reference';
import { normalizeAragonite, normalizeReference, normalEqual, type NormalNode } from './normalize';

export interface Divergence {
	input: string;
	ours: NormalNode[];
	theirs: NormalNode[];
}

export function diffInput(input: string): Divergence | null {
	const outcome = evaluateInput(input);
	return typeof outcome === 'string' ? null : outcome;
}

export function runDiff(inputs: string[]): {
	divergences: Divergence[];
	skipped: number;
	compared: number;
} {
	const divergences: Divergence[] = [];
	let skipped = 0;
	let compared = 0;
	for (const input of inputs) {
		const outcome = evaluateInput(input);
		if (outcome === 'skipped') {
			skipped++;
			continue;
		}
		compared++;
		if (outcome !== 'equal') divergences.push(outcome);
	}
	return { divergences, skipped, compared };
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Skipped = the input is not a single reference paragraph, so has no inline reading. */
function evaluateInput(input: string): 'skipped' | 'equal' | Divergence {
	const referenceNodes = referenceInlineNodes(input);
	if (referenceNodes === null) return 'skipped';
	const theirs = normalizeReference(referenceNodes);
	const ours = normalizeAragonite(parseInline(input, 0, input.length), input);
	return normalEqual(ours, theirs) ? 'equal' : { input, ours, theirs };
}

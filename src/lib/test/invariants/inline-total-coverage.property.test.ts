import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { InlineNode, InlineNodeKind } from '../../core/nodes';
import { scanInline } from '../../core/inline/scan';
import { arbInlineSource } from './arbitraries';
import { enumerateCorpus, loadSpecExamples, sampleCorpus } from '../gfm-conformance/corpus';
import {
	assertTotalCoverage,
	assertConstructCoverage
} from '../core/inline/scan/scan-test-helpers';

// G2.11: the scanner's editor-facing contract, which no conformance diff can
// judge — commonmark carries no offsets. Every byte of [start, end) lands in
// exactly one top-level node range, construct children tile their parent minus
// its markers, and every kind is in the InlineNodeKind vocabulary.

// `satisfies` keeps this runtime mirror exhaustive both ways: a union change
// without a matching edit here is a type error.
const KIND_VOCABULARY = {
	text: true,
	emphasis: true,
	strong: true,
	strikethrough: true,
	inlineCode: true,
	link: true,
	image: true,
	autolink: true,
	hardLineBreak: true,
	escape: true,
	entityReference: true,
	unresolvedReference: true,
	rawHtml: true
} satisfies Record<InlineNodeKind, true>;

const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_VOCABULARY));

function assertKnownKinds(nodes: InlineNode[]): void {
	for (const node of nodes) {
		if (!KNOWN_KINDS.has(node.kind)) {
			throw new Error(`unknown inline kind '${node.kind}' at [${node.start},${node.end})`);
		}
		if (node.children) assertKnownKinds(node.children);
	}
}

function assertScanContract(raw: string, start: number, end: number): void {
	const nodes = scanInline(raw, start, end);
	assertTotalCoverage(nodes, start, end);
	assertConstructCoverage(nodes);
	assertKnownKinds(nodes);
}

const PARAMS = { numRuns: 1000, seed: 424242 } as const;

describe('G2.11 scanner total coverage + construct tiling + kind vocabulary', () => {
	it('holds over adversarial inline sources', () => {
		fc.assert(
			fc.property(arbInlineSource, (source) => {
				assertScanContract(source, 0, source.length);
			}),
			PARAMS
		);
	});

	it('holds under a non-zero content start (heading-style offset)', () => {
		fc.assert(
			fc.property(arbInlineSource, (content) => {
				const raw = '## ' + content;
				assertScanContract(raw, 3, raw.length);
			}),
			PARAMS
		);
	});

	it('holds over the seeded conformance corpus', () => {
		// Spec examples included because generated corpora statistically miss
		// image-construct tiling (nested labels, dimension suffixes).
		const inputs = [
			...loadSpecExamples().map((example) => example.markdown.replace(/\n$/, '')),
			...enumerateCorpus(3),
			...sampleCorpus(20260706, 2000, 4, 12)
		];
		for (const input of inputs) {
			assertScanContract(input, 0, input.length);
		}
	});
});

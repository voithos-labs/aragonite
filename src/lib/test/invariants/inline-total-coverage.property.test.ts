import { afterEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode, InlineNodeKind } from '../../core/nodes';
import { scanInline } from '../../core/inline/scan';
import { isInlineKindDeclared } from '../../schema/plugin-kind';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes';
import { emojiPlugin, EMOJI_KIND } from '$lib/plugins/emoji';
import { latexPlugin, MATH_INLINE } from '$lib/plugins/latex';
import {
	arbInlineSource,
	arbLargeDoc,
	arbPluginInlineSource,
	freshOrFixedSeed
} from './arbitraries';
import { enumerateCorpus, loadSpecExamples, sampleCorpus } from '../gfm-conformance/corpus';
import {
	assertTotalCoverage,
	assertConstructCoverage
} from '../core/inline/scan/scan-test-helpers';

// G2.11: every byte of [start, end) lands in exactly one top-level node range, construct
// children tile their parent minus its markers, and every kind is in the vocabulary. No
// conformance diff can judge this — commonmark carries no offsets.

// `satisfies` keeps this runtime mirror exhaustive: a union change without a matching
// edit here is a type error.
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

/**
 * The VOCABULARY half: every kind is a built-in, or one an installed plugin declared.
 * Split from the contract half because a registered rung emits its own declared kind, so
 * asserting the union alone throws on vocabulary before it can test tiling.
 */
function assertKindVocabulary(nodes: InlineNode[]): void {
	for (const node of nodes) {
		if (!KNOWN_KINDS.has(node.kind) && !isInlineKindDeclared(node.kind)) {
			throw new Error(`unknown inline kind '${node.kind}' at [${node.start},${node.end})`);
		}
		if (node.children) assertKindVocabulary(node.children);
	}
}

/** The CONTRACT half: every byte tiled once, constructs tile their parent. */
function assertScanContract(raw: string, start: number, end: number): void {
	const nodes = scanInline(raw, start, end);
	assertTotalCoverage(nodes, start, end);
	assertConstructCoverage(nodes);
	assertKindVocabulary(nodes);
}

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

// The rungs-installed lane registers into process-global registries, so the bare-grammar
// lanes in this worker need the reset to stay bare.
afterEach(() => resetPluginPlatformForTests());

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

	it('holds with the bundled inline rungs installed', () => {
		// Registries are register-once, so the rungs install ONCE for the whole property;
		// the scan reads no state the cases mutate.
		resetPluginPlatformForTests();
		// The scan never renders, so a no-op renderer satisfies latex's required option.
		installPlugins([
			footnotesPlugin(),
			emojiPlugin(),
			latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) })
		]);
		// Without this a failed setup leaves the bare grammar running and the lane passes
		// for the wrong reason.
		for (const kind of [FOOTNOTE_REF_KIND, EMOJI_KIND, MATH_INLINE]) {
			expect(isInlineKindDeclared(kind), `rung not installed: ${kind}`).toBe(true);
		}

		fc.assert(
			fc.property(arbPluginInlineSource, (source) => {
				assertScanContract(source, 0, source.length);
			}),
			PARAMS
		);
	});

	// The size tier: a boundary error appearing only past some index (a quadratic decline's
	// bail-out, an offset overflowing a scan window) is unreachable at a few hundred bytes.
	it('holds over ~60KB single-line inputs', () => {
		fc.assert(
			fc.property(arbLargeDoc, (doc) => {
				const line = doc.slice(0, Math.min(doc.length, 60_000));
				assertScanContract(line, 0, line.length);
			}),
			{ numRuns: 20, seed: freshOrFixedSeed(424242), endOnFailure: true }
		);
	}, 60_000);

	it('holds over the seeded conformance corpus', () => {
		// Generated corpora statistically miss image-construct tiling (nested labels,
		// dimension suffixes), so the spec examples are drawn in too.
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

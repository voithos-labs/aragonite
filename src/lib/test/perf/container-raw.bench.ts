// Every keystroke inside a nested container pays a full ancestry raw rebuild.
// These rows drive the SHIPPED rebuild (`rebuildUnsharedChain` — the function
// the routine-typing path calls) over an owned spine, so the numbers track the
// real per-keystroke cost, not a hand-rolled stand-in.
//
// Three axes:
//   depth    — nested fixture, thousands of tiny lists: each rebuild touches
//              little raw, so this isolates chain length.
//   breadth  — one flat list at depth 1: the list rebuild re-joins every item,
//              the O(container-size) cliff.
//   combined — deep-nested: depth AND per-level bytes together, the axis the
//              other two miss. This is the concern-4 falsification instrument.
import { bench, describe } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { createSharingState } from '../../tree-operations/sharing';
import { rebuildUnsharedChain } from '../../tree-operations/unshare';
import { generateDeepNested, generateFixture } from './fixtures/generate';

function deepestChain(node: CstNode, chain: CstNode[] = []): CstNode[] {
	chain.push(node);
	const containerChild = node.children?.find((c) => c.children);
	return containerChild ? deepestChain(containerChild, chain) : chain;
}

// Bench the shipped ancestry rebuild over the deepest owned spine under `root`.
// A fresh sharing state sits at epoch 0, so nothing reads as shared and the
// chain is the live-owned spine — the steady-typing condition (the debounced
// snapshot re-shares only ~once per 250ms, amortized away across keystrokes).
function benchAncestryRebuild(
	label: string,
	root: CstNode,
	opts: { iterations?: number; time?: number }
): void {
	const chain = deepestChain(root);
	const sharing = createSharingState();
	bench(label, () => rebuildUnsharedChain(chain, sharing), { warmupIterations: 1, ...opts });
}

function singleFlatList(targetBytes: number): string {
	const lines: string[] = [];
	for (let i = 0, size = 0; size < targetBytes; i++) {
		const line = `- item ${i}\n`;
		lines.push(line);
		size += line.length;
	}
	return lines.join('');
}

describe('ancestry rebuild — depth axis', () => {
	const doc = parse(generateFixture('nested-containers', 1_000_000));
	const chain = deepestChain(doc.children.find((c) => c.kind === 'list')!);
	benchAncestryRebuild(`rebuild depth-${chain.length} ancestry (many tiny lists, 1MB)`, chain[0], {
		iterations: 50
	});
});

describe('ancestry rebuild — breadth axis', () => {
	const SIZES: Array<[label: string, bytes: number, opts: { iterations?: number; time?: number }]> =
		[
			['100KB', 100_000, { iterations: 50 }],
			['1MB', 1_000_000, { iterations: 10 }],
			['10MB', 10_000_000, { time: 3_000 }]
		];
	for (const [label, bytes, opts] of SIZES) {
		const doc = parse(singleFlatList(bytes));
		benchAncestryRebuild(`rebuild breadth: single ${label} list`, doc.children[0], opts);
	}
});

// The combined axis: realistic deep nesting where every ancestor level carries
// substantial raw, so one rebuild pays Σ(level raw) ≈ amplification × doc bytes.
// depth {4,8,12} × per-level {1KB,10KB,50KB}, plus one adversarial point past
// the realistic envelope (reported, not judged against the verdict bounds).
describe('ancestry rebuild — combined depth × bytes axis', () => {
	const DEPTHS = [4, 8, 12] as const;
	const PER_LEVEL: Array<[label: string, bytes: number]> = [
		['1KB', 1_000],
		['10KB', 10_000],
		['50KB', 50_000]
	];
	for (const depth of DEPTHS) {
		for (const [byteLabel, bytes] of PER_LEVEL) {
			const doc = parse(generateDeepNested(depth, bytes));
			benchAncestryRebuild(
				`rebuild deep-nested: depth ${depth} × ${byteLabel}/level`,
				doc.children[0],
				{
					iterations: 30
				}
			);
		}
	}

	const adversarial = parse(generateDeepNested(16, 100_000));
	benchAncestryRebuild(
		'rebuild deep-nested: depth 16 × 100KB/level (adversarial)',
		adversarial.children[0],
		{
			iterations: 20
		}
	);
});

// Every short string over the Markdown alphabet reads inline without throwing, and each leaf's
// inline nodes cover its content exactly, one after another, with the bundled plugins' syntax.
import { it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { getContentRange, parseInline } from '#lib/core/inline/index.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { enumerateStrings } from '../gfm-conformance/corpus';
import { ALPHABET_PLUGINS, EXHAUSTIVE_ALPHABET, INLINE_LENGTH } from './alphabet';
import { holdToKnownFailures } from './known-failures';

function* leavesOf(nodes: readonly CstNode[]): Generator<CstNode> {
	for (const node of nodes) {
		if (node.children) yield* leavesOf(node.children);
		else yield node;
	}
}

/** Where the leaf's top-level inline nodes first leave a gap or overlap, or null. */
function coverageGap(leaf: CstNode): string | null {
	const { start, end } = getContentRange(leaf);
	let at = start;
	for (const node of parseInline(leaf.raw, start, end)) {
		if (node.start !== at) return `${node.kind} starts at ${node.start}, expected ${at}`;
		at = node.end;
	}
	return at === end || start === end ? null : `nodes end at ${at}, content at ${end}`;
}

it(`reads every string up to length ${INLINE_LENGTH} inline, covering each leaf`, () => {
	installPlugins(ALPHABET_PLUGINS());
	const failures: string[] = [];
	for (const source of enumerateStrings(EXHAUSTIVE_ALPHABET, 1, INLINE_LENGTH)) {
		try {
			for (const leaf of leavesOf(parse(source).children)) {
				const gap = coverageGap(leaf);
				if (gap) failures.push(`${JSON.stringify(source)} ${leaf.kind}: ${gap}`);
			}
		} catch (error) {
			failures.push(`${JSON.stringify(source)} threw ${String(error)}`);
		}
	}
	holdToKnownFailures('inline', failures, INLINE_LENGTH);
}, 900_000);

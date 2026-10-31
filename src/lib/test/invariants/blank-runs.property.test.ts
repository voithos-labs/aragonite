// @vitest-environment jsdom
// A write that blanks a block, fills one, or erases its last line leaves the blank lines around
// it where a reload puts them, inside bodies between fence lines too (G2.13, G1.145).
// Miss-analysis: the shape property drew top-level blocks only and compared block counts, so a
// body under a fence line and a separator on the wrong block of a run went unread.
import { describe, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { isBlankParagraph, parse } from '#lib/core/parser.js';
import { documentLineEnding, trailingLineEnding } from '#lib/core/lines.js';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { updateNodeContent } from '#lib/tree-operations/content-write.js';
import { rebuildUnsharedChain } from '#lib/tree-operations/chain-rebuild.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { settled } from '#lib/test/harness/settle-funnel.js';
import { describeConvergence, describeRunDivergence } from '#lib/test/harness/parse-converged.js';
import { freshOrFixedSeed } from './arbitraries';
import { arbFencedBodyDoc } from './arbitraries/plugin-syntax';

const PARAMS = { numRuns: 300, seed: freshOrFixedSeed(632632) } as const;

type Write = 'empty' | 'fill' | 'erase';

/** A leaf and the containers above it, whose raw the write rebuilds. */
type LeafSlot = { holder: Document | CstNode; index: number; chain: CstNode[] };

function leafSlots(node: Document | CstNode, chain: CstNode[] = []): LeafSlot[] {
	return (node.children ?? []).flatMap((child, index) => {
		if (child.children !== undefined) return leafSlots(child, [...chain, child]);
		const prose = getBlockKindDescriptor(child.kind).supportsInline === true;
		return prose ? [{ holder: node, index, chain }] : [];
	});
}

/** The text each write puts in the leaf, or null when the leaf can't take it. */
function textFor(write: Write, raw: string, ending: string): string | null {
	const blank = isBlankParagraph({ kind: 'paragraph', raw });
	if (write === 'empty') return blank ? null : trailingLineEnding(raw, ending as '\n');
	if (write === 'fill') return blank ? 'x' + trailingLineEnding(raw, ending as '\n') : null;
	// The last line's text goes and its line stays, as Backspace leaves it.
	const lines = raw.replace(/\r?\n$/, '').split(/\r?\n/);
	if (lines.length < 2 || lines.at(-1) === '') return null;
	return lines.slice(0, -1).join(ending) + ending + ending;
}

function writeLeaf(doc: Document, slot: LeafSlot, text: string): void {
	const { holder, index, chain } = slot;
	if (holder === doc) {
		settled(
			doc,
			() => updateNodeContent(doc, index, text, defaultGrammarView, createSharingState()).change
		);
		return;
	}
	const owner = holder as CstNode;
	updateNodeContent(
		{ children: owner.children!, owner, lineEnding: documentLineEnding(doc) },
		index,
		text,
		defaultGrammarView,
		createSharingState()
	);
	rebuildUnsharedChain(doc, chain, createSharingState(), null, defaultGrammarView);
}

function divergenceAfter(source: string, write: Write, pick: number): string | null {
	const doc = parse(source);
	const slots = leafSlots(doc).flatMap((slot) => {
		const raw = slot.holder.children![slot.index].raw;
		const text = textFor(write, raw, documentLineEnding(doc));
		return text === null ? [] : [{ slot, text }];
	});
	if (slots.length === 0) return null;
	const { slot, text } = slots[pick % slots.length];
	writeLeaf(doc, slot, text);
	const divergence = describeConvergence(doc) ?? describeRunDivergence(doc);
	return divergence && `${write} of ${JSON.stringify(text)}: ${divergence}`;
}

describe('the blank lines a write leaves read back as they stand', () => {
	beforeEach(() => {
		installPlugins([admonitionsPlugin(), detailsPlugin()]);
	});

	it.each(['empty', 'fill', 'erase'] as const)('%s, at any depth', (write) => {
		fc.assert(
			fc.property(arbFencedBodyDoc, fc.nat(), (source, pick) => {
				const divergence = divergenceAfter(source, write, pick);
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});
});

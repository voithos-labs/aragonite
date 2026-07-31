import { describe, expect, it } from 'vitest';
import { Parser, type Node } from 'commonmark';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { roundTripCases } from '$lib/test/support/round-trip';

/**
 * Narrowing the blank-line test to space-and-tab (GFM §2.1) moves block structure on
 * several axes at once, so each is pinned against commonmark.js rather than itself —
 * sound here because the GFM extensions leave §2.1, §4.4/§4.6, §5.1 and §5.2 untouched.
 * Block outlines only: the reference's inline stage `String.trim()`s an NBSP cmark-gfm
 * keeps, so its rendered HTML is not a usable oracle.
 */

const NBSP = String.fromCharCode(0xa0);

const AXES: { axis: string; source: string }[] = [
	{ axis: 'paragraph continuation', source: `a\n${NBSP}\nb\n` },
	{ axis: 'nbsp-only document', source: `${NBSP}\n` },
	{ axis: 'blockquote extent', source: `> a\n${NBSP}\n> b\n` },
	{ axis: 'list gap', source: `- a\n${NBSP}\n- b\n` },
	{ axis: 'indented-code reach', source: `    code1\n${NBSP}\n    code2\n` },
	{ axis: 'html-block termination', source: `<div>\n${NBSP}\n</div>\n` }
];

// ── Block outlines ───────────────────────────────────────────────────────────

const REFERENCE_BLOCKS = new Set([
	'paragraph',
	'block_quote',
	'list',
	'item',
	'code_block',
	'html_block',
	'heading',
	'thematic_break'
]);

const KIND_AS_REFERENCE: Record<string, string> = {
	paragraph: 'paragraph',
	blockquote: 'block_quote',
	list: 'list',
	listItem: 'item',
	indentedCode: 'code_block',
	fencedCode: 'code_block',
	htmlBlock: 'html_block',
	heading: 'heading',
	thematicBreak: 'thematic_break'
};

function referenceOutline(markdown: string): string[] {
	const walker = new Parser().parse(markdown).walker();
	const outline: string[] = [];
	let depth = 0;
	let event: { entering: boolean; node: Node } | null;
	while ((event = walker.next()) !== null) {
		if (!REFERENCE_BLOCKS.has(event.node.type)) continue;
		if (!event.entering) {
			depth--;
			continue;
		}
		outline.push('  '.repeat(depth) + event.node.type);
		// A leaf block reports no exit event, so only a container moves the depth.
		if (event.node.isContainer) depth++;
	}
	return outline;
}

function editorOutline(markdown: string): string[] {
	const outline: string[] = [];
	const visit = (nodes: CstNode[], depth: number): void => {
		for (const node of nodes) {
			outline.push('  '.repeat(depth) + (KIND_AS_REFERENCE[node.kind] ?? node.kind));
			if (node.children) visit(node.children, depth + 1);
		}
	};
	visit(parse(markdown).children, 0);
	return outline;
}

// ── The pass ─────────────────────────────────────────────────────────────────

describe('a non-breaking space is content on every block axis', () => {
	it.each(AXES.map((a): [string, string] => [a.axis, a.source]))('%s', (_axis, source) => {
		expect(editorOutline(source)).toEqual(referenceOutline(source));
	});

	it('is not vacuous — the outline distinguishes the pre-narrowing structure', () => {
		expect(referenceOutline(`a\n${NBSP}\nb\n`)).toEqual(['paragraph']);
		expect(referenceOutline('a\n\nb\n')).toEqual(['paragraph', 'paragraph']);
	});
});

describe('blank-line axes round-trip byte-for-byte', () => {
	roundTripCases(AXES.map(({ axis, source }) => ({ name: axis, source })));
});

/**
 * A document's block outline, one indented line per block, from the editor's parser and from
 * commonmark.js, so a conformance test compares structure without comparing rendered HTML.
 */

import { Parser, type Node } from 'commonmark';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';

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
	setextHeading: 'heading',
	thematicBreak: 'thematic_break'
};

// commonmark.js keeps no node for a link reference definition.
const UNSEEN_BY_REFERENCE = new Set(['linkReferenceDefinition']);

export function referenceOutline(markdown: string): string[] {
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

/** The editor's outline in the reference's names; a kind the reference lacks keeps its own. */
export function editorOutline(markdown: string): string[] {
	const outline: string[] = [];
	const visit = (nodes: CstNode[], depth: number): void => {
		for (const node of nodes) {
			if (UNSEEN_BY_REFERENCE.has(node.kind)) continue;
			outline.push('  '.repeat(depth) + (KIND_AS_REFERENCE[node.kind] ?? node.kind));
			if (node.children) visit(node.children, depth + 1);
		}
	};
	visit(parse(markdown).children, 0);
	return outline;
}

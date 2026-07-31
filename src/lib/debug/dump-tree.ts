import type { DocumentView, NodeView } from '../core/node-views';
import { isBuiltinBlockNode } from '../core/nodes';
import { trimTrailingLineEnding } from '../core/lines';

export interface DumpTreeOptions {
	maxRawChars?: number;
	showAllMetadata?: boolean;
	includeInline?: boolean;
}

const DEFAULTS: Required<DumpTreeOptions> = {
	maxRawChars: 40,
	showAllMetadata: false,
	includeInline: false
};

export function dumpTree(doc: DocumentView, opts: DumpTreeOptions = {}): string {
	const options = { ...DEFAULTS, ...opts };
	if (!doc.children || doc.children.length === 0) return '';
	const lines: string[] = [];
	for (let i = 0; i < doc.children.length; i++) {
		renderNode(doc.children[i], i, 0, lines, options);
	}
	return lines.join('\n');
}

function renderNode(
	node: NodeView,
	index: number,
	depth: number,
	lines: string[],
	opts: Required<DumpTreeOptions>
): void {
	const indent = '  '.repeat(depth);
	const header: string[] = [`${indent}[${index}] ${node.kind}`];
	const meta = formatMetadata(node, opts);
	if (meta) header.push(meta);
	if (node.children && node.children.length > 0) {
		header.push(`children=${node.children.length}`);
	}

	const rawDisplay = truncate(trimTrailingLineEnding(node.raw), opts.maxRawChars);
	const triviaStr =
		node.leadingTrivia && node.leadingTrivia.length > 0
			? `trivia=${JSON.stringify(node.leadingTrivia)}`
			: null;

	if (rawDisplay.includes('\n')) {
		// Continuation lines take one extra column so they align after the opening quote
		// instead of reading as child entries, which start with `[` at the same indent.
		if (triviaStr) header.push(triviaStr);
		lines.push(header.join(' '));
		const rawLines = rawDisplay.split('\n');
		const rawIndent = indent + '  ';
		const contIndent = rawIndent + ' ';
		lines.push(`${rawIndent}"${rawLines[0]}`);
		for (let i = 1; i < rawLines.length - 1; i++) {
			lines.push(`${contIndent}${rawLines[i]}`);
		}
		lines.push(`${contIndent}${rawLines[rawLines.length - 1]}"`);
	} else {
		header.push(`"${rawDisplay}"`);
		if (triviaStr) header.push(triviaStr);
		lines.push(header.join(' '));
	}

	if (node.children && node.children.length > 0) {
		for (let i = 0; i < node.children.length; i++) {
			renderNode(node.children[i], i, depth + 1, lines, opts);
		}
	}
}

function formatMetadata(node: NodeView, opts: Required<DumpTreeOptions>): string {
	const m = node.metadata;
	if (!m) return '';
	const frags: string[] = [];
	// Narrowing to the built-in union lets each arm read its own metadata directly, with no
	// `'field' in m` probing.
	if (isBuiltinBlockNode(node)) {
		switch (node.kind) {
			case 'heading':
			case 'setextHeading':
				if (node.metadata.level) frags.push(`level=${node.metadata.level}`);
				break;
			case 'fencedCode':
				if (node.metadata.info) frags.push(`info=${JSON.stringify(node.metadata.info)}`);
				if (node.metadata.fenceMarker)
					frags.push(`fence=${JSON.stringify(node.metadata.fenceMarker)}`);
				if (node.metadata.fenceLength) frags.push(`fenceLength=${node.metadata.fenceLength}`);
				break;
			case 'thematicBreak':
				if (node.metadata.marker) frags.push(`marker=${JSON.stringify(node.metadata.marker)}`);
				break;
			case 'list':
				frags.push(`kind=${node.metadata.ordered ? 'ordered' : 'bullet'}`);
				break;
			case 'listItem':
				if (node.metadata.marker) frags.push(`marker=${JSON.stringify(node.metadata.marker)}`);
				if (node.metadata.taskItem) frags.push(`task=${node.metadata.taskChecked ? 'x' : ' '}`);
				break;
			case 'blockquote':
				if (node.metadata.quoteDepth) frags.push(`quoteDepth=${node.metadata.quoteDepth}`);
				break;
			case 'linkReferenceDefinition':
				if (node.metadata.label) frags.push(`label=${JSON.stringify(node.metadata.label)}`);
				break;
			case 'table':
				if (node.metadata.columnCount) frags.push(`columnCount=${node.metadata.columnCount}`);
				break;
			default:
				break;
		}
	}
	if (opts.showAllMetadata) frags.push(`metaRaw=${JSON.stringify(m)}`);
	return frags.join(' ');
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + '…';
}

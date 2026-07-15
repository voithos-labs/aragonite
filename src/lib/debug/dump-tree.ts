import type { DocumentView, NodeView } from '../core/node-views';

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

	const rawDisplay = truncate(trimTrailingNewline(node.raw), opts.maxRawChars);
	const triviaStr =
		node.leadingTrivia && node.leadingTrivia.length > 0
			? `trivia=${JSON.stringify(node.leadingTrivia)}`
			: null;

	if (rawDisplay.includes('\n')) {
		// Continuation lines are offset one extra column so they align after
		// the opening quote and aren't mistaken for child entries (which start
		// with `[` at the same indent).
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
	switch (node.kind) {
		case 'heading':
		case 'setextHeading':
			if ('level' in m && m.level) frags.push(`level=${m.level}`);
			break;
		case 'fencedCode':
			if ('info' in m && m.info) frags.push(`info=${JSON.stringify(m.info)}`);
			if ('fenceMarker' in m && m.fenceMarker) frags.push(`fence=${JSON.stringify(m.fenceMarker)}`);
			if ('fenceLength' in m && m.fenceLength) frags.push(`fenceLength=${m.fenceLength}`);
			break;
		case 'thematicBreak':
			if ('marker' in m && m.marker) frags.push(`marker=${JSON.stringify(m.marker)}`);
			break;
		case 'list':
			if ('ordered' in m) frags.push(`kind=${m.ordered ? 'ordered' : 'bullet'}`);
			break;
		case 'listItem':
			if ('marker' in m && m.marker) frags.push(`marker=${JSON.stringify(m.marker)}`);
			if ('taskItem' in m && m.taskItem && 'taskChecked' in m) {
				frags.push(`task=${m.taskChecked ? 'x' : ' '}`);
			}
			break;
		case 'blockquote':
			if ('quoteDepth' in m && m.quoteDepth) frags.push(`quoteDepth=${m.quoteDepth}`);
			break;
		case 'linkReferenceDefinition':
			if ('label' in m && m.label) frags.push(`label=${JSON.stringify(m.label)}`);
			break;
		case 'table':
			if ('columnCount' in m && m.columnCount) frags.push(`columnCount=${m.columnCount}`);
			break;
		default:
			// Plugin and metadata-less kinds: no kind-specific fragments; the
			// generic path still prints kind + raw.
			break;
	}
	if (opts.showAllMetadata) frags.push(`metaRaw=${JSON.stringify(m)}`);
	return frags.join(' ');
}

function trimTrailingNewline(raw: string): string {
	return raw.endsWith('\r\n') ? raw.slice(0, -2) : raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + '…';
}

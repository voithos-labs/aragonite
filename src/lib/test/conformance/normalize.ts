/**
 * Both parsers map into this common shape before comparison, so the differ
 * (task A4) tests semantic agreement, not incidental AST-shape differences.
 * Only the fields a GFM inline construct actually carries survive; offsets,
 * link labels, image dimensions, and reference bookkeeping are dropped.
 *
 * Deliberately NOT reconciled here: URL and code-span content differences
 * (percent-encoding, whitespace folding). Those are real divergences the
 * baseline records — normalizing them away would hide conformance gaps.
 */
import type { Node as CommonmarkNode } from 'commonmark';
import type { InlineNode } from '../../core/nodes';

export interface NormalNode {
	kind: 'text' | 'emphasis' | 'strong' | 'code' | 'link' | 'image' | 'html' | 'hardbreak';
	text?: string;
	url?: string;
	title?: string;
	children?: NormalNode[];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function normalizeAragonite(nodes: InlineNode[], raw: string): NormalNode[] {
	return canonicalize(nodes.map((node) => mapAragonite(node, raw)));
}

export function normalizeReference(nodes: CommonmarkNode[]): NormalNode[] {
	return canonicalize(nodes.map(mapReference));
}

export function normalEqual(a: NormalNode[], b: NormalNode[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((node, i) => nodeEqual(node, b[i]));
}

// ── Aragonite → NormalNode ───────────────────────────────────────────────────

function mapAragonite(node: InlineNode, raw: string): NormalNode {
	switch (node.kind) {
		case 'text':
			return { kind: 'text', text: node.text ?? raw.slice(node.start, node.end) };
		case 'escape':
			return { kind: 'text', text: raw.slice(node.start + 1, node.end) };
		case 'entityReference':
			return { kind: 'text', text: node.decoded ?? raw.slice(node.start, node.end) };
		case 'unresolvedReference':
			return { kind: 'text', text: raw.slice(node.start, node.end) };
		case 'emphasis':
		case 'strong':
			return { kind: node.kind, children: mapAragoniteChildren(node.children, raw) };
		case 'inlineCode':
			return { kind: 'code', text: node.text ?? raw.slice(node.start, node.end) };
		case 'link':
			return {
				kind: 'link',
				url: node.url,
				...titleField(node.title),
				children: mapAragoniteChildren(node.children, raw)
			};
		case 'autolink':
			return {
				kind: 'link',
				url: node.url,
				children: [{ kind: 'text', text: autolinkLabel(node, raw) }]
			};
		case 'image':
			return {
				kind: 'image',
				url: node.url,
				...titleField(node.title),
				children: [{ kind: 'text', text: node.alt ?? '' }]
			};
		case 'hardLineBreak':
			return { kind: 'hardbreak' };
		case 'rawHtml':
			return { kind: 'html', text: raw.slice(node.start, node.end) };
		case 'strikethrough':
			throw new Error('normalize: strikethrough should never reach the differ (corpus excludes ~)');
	}
}

function mapAragoniteChildren(children: InlineNode[] | undefined, raw: string): NormalNode[] {
	return (children ?? []).map((child) => mapAragonite(child, raw));
}

/** Autolink display text: angle-bracket form strips `<`/`>`; bare form is verbatim. */
function autolinkLabel(node: InlineNode, raw: string): string {
	if (raw[node.start] === '<' && raw[node.end - 1] === '>') {
		return raw.slice(node.start + 1, node.end - 1);
	}
	return raw.slice(node.start, node.end);
}

// ── Commonmark → NormalNode ──────────────────────────────────────────────────

function mapReference(node: CommonmarkNode): NormalNode {
	switch (node.type) {
		case 'text':
			return { kind: 'text', text: node.literal ?? '' };
		case 'softbreak':
			return { kind: 'text', text: '\n' };
		case 'linebreak':
			return { kind: 'hardbreak' };
		case 'emph':
			return { kind: 'emphasis', children: mapReferenceChildren(node) };
		case 'strong':
			return { kind: 'strong', children: mapReferenceChildren(node) };
		case 'code':
			return { kind: 'code', text: node.literal ?? '' };
		case 'link':
			return {
				kind: 'link',
				url: node.destination ?? '',
				...titleField(node.title),
				children: mapReferenceChildren(node)
			};
		case 'image':
			return {
				kind: 'image',
				url: node.destination ?? '',
				...titleField(node.title),
				children: mapReferenceChildren(node)
			};
		case 'html_inline':
			return { kind: 'html', text: node.literal ?? '' };
		default:
			throw new Error(`normalize: unmapped commonmark node type '${node.type}'`);
	}
}

function mapReferenceChildren(node: CommonmarkNode): NormalNode[] {
	const children: NormalNode[] = [];
	for (let child = node.firstChild; child; child = child.next) children.push(mapReference(child));
	return children;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Untitled links/images: commonmark emits `title === ''`, aragonite omits the
 * field. Both mean "no title", so collapse the empty form to absent — otherwise
 * every untitled link diverges on representation alone.
 */
function titleField(title: string | null | undefined): { title?: string } {
	return title ? { title } : {};
}

/** Merge adjacent text, drop empty text, recursively into children. */
function canonicalize(nodes: NormalNode[]): NormalNode[] {
	const result: NormalNode[] = [];
	for (const node of nodes) {
		const merged = node.children ? { ...node, children: canonicalize(node.children) } : node;
		if (merged.kind === 'text') {
			if ((merged.text ?? '') === '') continue;
			const prev = result[result.length - 1];
			if (prev?.kind === 'text') {
				prev.text = (prev.text ?? '') + (merged.text ?? '');
				continue;
			}
		}
		result.push(merged);
	}
	return result;
}

function nodeEqual(a: NormalNode, b: NormalNode): boolean {
	return (
		a.kind === b.kind &&
		a.text === b.text &&
		a.url === b.url &&
		a.title === b.title &&
		normalEqual(a.children ?? [], b.children ?? [])
	);
}

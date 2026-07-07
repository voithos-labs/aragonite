/**
 * Both parsers map into this common shape before comparison, so the differ
 * (task A4) tests semantic agreement, not incidental AST-shape differences.
 * Only the fields a GFM inline construct actually carries survive; offsets,
 * link labels, image dimensions, and reference bookkeeping are dropped.
 *
 * Audited reconciliations (each recorded in baseline.json's
 * normalizerReconciliations) are applied to BOTH sides' normal form: empty-title
 * coalescing, §6.1 code-span folding, §6.8 softbreak space-trimming. URL content
 * differences (percent-encoding) stay unreconciled — those are real divergences
 * the baseline records, and normalizing them away would hide conformance gaps.
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

/**
 * Merge adjacent text and drop empty text, apply the display-model
 * reconciliations, then merge/drop again — recursively into children.
 * Reconciling must follow the first merge: the reference side emits softbreaks
 * as separate '\n' text nodes, so the space-before-newline pattern only exists
 * once adjacent text is joined. The second pass restores the merged/nonempty
 * canonical form no matter what a reconciliation emits.
 */
function canonicalize(nodes: NormalNode[]): NormalNode[] {
	const withChildren = nodes.map((node) =>
		node.children ? { ...node, children: canonicalize(node.children) } : node
	);
	return mergeText(mergeText(withChildren).map(reconcile));
}

function mergeText(nodes: NormalNode[]): NormalNode[] {
	const result: NormalNode[] = [];
	for (const node of nodes) {
		if (node.kind === 'text') {
			if ((node.text ?? '') === '') continue;
			const prev = result[result.length - 1];
			if (prev?.kind === 'text') {
				prev.text = (prev.text ?? '') + (node.text ?? '');
				continue;
			}
		}
		result.push(node);
	}
	return result;
}

function reconcile(node: NormalNode): NormalNode {
	if (node.kind === 'code') return { ...node, text: foldCodeText(node.text ?? '') };
	if (node.kind === 'text') return { ...node, text: trimSoftbreakSpaces(node.text ?? '') };
	return node;
}

/**
 * CommonMark §6.1: fold code-span content — line endings become spaces; strip
 * one flanking space when both sides have one and content isn't all spaces.
 * Display keeps raw bytes (styled-source model); this is the spec-semantic
 * view only.
 */
function foldCodeText(text: string): string {
	const folded = text.replace(/\r\n|\r|\n/g, ' ');
	if (folded.length >= 2 && folded.startsWith(' ') && folded.endsWith(' ') && folded.trim() !== '')
		return folded.slice(1, -1);
	return folded;
}

/**
 * CommonMark §6.8: spaces at the end of a line before a softbreak are not
 * content. Applied to text-node text around embedded '\n' (hard breaks are
 * separate nodes by this point on both sides).
 */
function trimSoftbreakSpaces(text: string): string {
	return text.replace(/[ \t]+\n/g, '\n');
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

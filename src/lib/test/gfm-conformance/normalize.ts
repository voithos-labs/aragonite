/**
 * Both parsers map into this common shape so the differ tests semantic agreement, not
 * incidental AST-shape differences. Reconciliations are audited in baseline.json's
 * `normalizerReconciliations`; URL percent-encoding stays unreconciled on purpose —
 * normalizing it away would hide real conformance gaps.
 */
import type { Node as CommonmarkNode } from 'commonmark';
import { isBuiltinInlineKind, type InlineNode } from '../../core/nodes';

export interface NormalNode {
	kind: 'text' | 'emphasis' | 'strong' | 'code' | 'link' | 'image' | 'html' | 'hardbreak';
	text?: string;
	url?: string;
	title?: string;
	children?: NormalNode[];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function normalizeAragonite(nodes: InlineNode[], raw: string): NormalNode[] {
	return foldToSpecSemantics(canonicalize(nodes.map((node) => mapAragonite(node, raw))));
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
	// AnyInlineKind admits plugin kinds; exclude them so the switch stays total
	// over InlineNodeKind. Plugin inline kinds never reach the conformance corpus.
	if (!isBuiltinInlineKind(node.kind)) {
		throw new Error(`normalize: unmapped inline kind '${node.kind}'`);
	}
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
			// Our side compares images by flattened alt STRING while the reference
			// keeps structured children — the image-alt-structure deliberate class
			// rests on this asymmetry; do not restructure without re-adjudicating it.
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

// ── Aragonite-only reconciliations ───────────────────────────────────────────

/**
 * Fold our byte-preserving form to the spec-semantic one the reference AST already
 * carries (§6.1, §6.8); folding its side too would double-strip. Runs after canonicalize.
 * Blind spot: one-sided folding can mask our own wrong bytes that fold to the right
 * string, so offset errors are caught by the scan suites and the total-coverage property.
 */
function foldToSpecSemantics(nodes: NormalNode[]): NormalNode[] {
	return nodes.map((node) => {
		const folded = node.children ? { ...node, children: foldToSpecSemantics(node.children) } : node;
		if (folded.kind === 'code') return { ...folded, text: foldCodeText(folded.text ?? '') };
		if (folded.kind === 'text') return { ...folded, text: trimSoftbreakSpaces(folded.text ?? '') };
		return folded;
	});
}

/**
 * CommonMark §6.1 line-ending and flanking-space folding — the spec-semantic view
 * only; the styled-source display keeps the raw bytes.
 */
function foldCodeText(text: string): string {
	const folded = text.replace(/\r\n|\r|\n/g, ' ');
	if (folded.length >= 2 && folded.startsWith(' ') && folded.endsWith(' ') && folded.trim() !== '')
		return folded.slice(1, -1);
	return folded;
}

/**
 * CommonMark §6.8: pre-softbreak spaces are not content. Spaces only — the reference
 * keeps a tab there, so trimming tabs would manufacture divergence.
 */
function trimSoftbreakSpaces(text: string): string {
	return text.replace(/ +\n/g, '\n');
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
 * Untitled links/images: commonmark emits `title === ''`, aragonite omits the field.
 * Collapsing the empty form to absent keeps representation alone from diverging.
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

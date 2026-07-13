/**
 * Both parsers map into this common shape before comparison, so the differ tests
 * semantic agreement, not incidental AST-shape differences. Only the fields a GFM
 * inline construct actually carries survive; offsets, link labels, image dimensions,
 * and reference bookkeeping are dropped.
 *
 * Audited reconciliations (each recorded in baseline.json's
 * normalizerReconciliations): empty-title coalescing on both sides; §6.1
 * code-span folding and §6.8 softbreak space-trimming on the aragonite side
 * only, because the reference AST is already spec-folded and transforming it
 * again would double-strip. URL content differences (percent-encoding) stay
 * unreconciled — those are real divergences the baseline records, and
 * normalizing them away would hide conformance gaps.
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
 * Fold our byte-preserving normal form to the spec-semantic form the reference
 * AST already carries: commonmark's parser applies §6.1 code-span folding and
 * strips pre-softbreak spaces (§6.8) before building its tree, so transforming
 * its side too would double-strip (' x ' → 'x'). Runs after canonicalize so
 * trailing spaces and their newline sit in one merged text node.
 *
 * One-sided folding could in principle mask wrong bytes on our side that fold
 * to the right string (e.g. content ' x ' where the source had 'x'). Accepted:
 * our content bytes derive from raw offsets, and offset errors surface in the
 * scan unit suites and the total-coverage property, while symmetric folding
 * costs a permanent divergence tail on every ≥2-flanking-space code span.
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
 * CommonMark §6.1: line endings become spaces; strip one flanking space when
 * both ends have one and content isn't all spaces. Display keeps raw bytes
 * (styled-source model); this is the spec-semantic view only.
 */
function foldCodeText(text: string): string {
	const folded = text.replace(/\r\n|\r|\n/g, ' ');
	if (folded.length >= 2 && folded.startsWith(' ') && folded.endsWith(' ') && folded.trim() !== '')
		return folded.slice(1, -1);
	return folded;
}

/**
 * CommonMark §6.8: spaces at the end of a line before a softbreak are not
 * content. Spaces only — the reference keeps a tab before a softbreak, so
 * trimming tabs here would manufacture divergence. Hard breaks are separate
 * nodes by this point, so their two-space marker is never in text.
 *
 * Keys on `\n` bytes regardless of provenance: if a corpus widening ever spells
 * an entity-decoded newline after a space (`foo &#10;bar`), the resulting
 * divergence is deliberate — §6.8 is a line-ending rule and the decoded byte is
 * indistinguishable here from a source newline.
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

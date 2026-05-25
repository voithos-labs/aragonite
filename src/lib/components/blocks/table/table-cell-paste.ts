/**
 * Inline + structural paste hooks for tableCell. Both live together so the
 * tableCell PasteSurface registration in dispatch.ts can wire them as a pair.
 * The structural hook is a sentinel — see its body.
 */

import { CURSOR_END } from '../../../block-component';
import type { CstNode } from '../../../core/nodes';
import type {
	InlinePasteResult,
	PasteRange,
	StructuralPasteResult
} from '../../../tree-operations/paste-surfaces';

// ── Public API ─────────────────────────────────────────────────────────────

export function escapeUnescapedPipes(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch !== '|') {
			out += ch;
			continue;
		}
		let backslashes = 0;
		for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
		out += backslashes % 2 === 0 ? '\\|' : '|';
	}
	return out;
}

export function normalizeWhitespace(s: string): string {
	return s.replace(/\n+/g, ' ').trim();
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const cleaned = escapeUnescapedPipes(normalizeWhitespace(text));

	let raw = node.raw;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		raw = raw.slice(0, preDelete.start) + raw.slice(preDelete.end);
		effectiveOffset = preDelete.start;
	}

	const newRaw = raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset);
	return {
		newRaw,
		caretOffset: effectiveOffset + cleaned.length
	};
}

export function tableCellStructuralPaste(
	_node: CstNode,
	_offset: number,
	_blocks: CstNode[],
	_preDelete?: PasteRange
): StructuralPasteResult {
	// Empty replacement signals to dispatch.ts that this paste must take the
	// table-break-and-splice path; the sentinel keeps PasteSurface contract
	// uniform without piling kind checks into the call site.
	return {
		replacement: [],
		focusReplacementIndex: 0,
		focusOffset: CURSOR_END
	};
}

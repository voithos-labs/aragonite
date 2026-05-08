/**
 * CommonMark §4.7 link-label normalization plus the document-level
 * resolver built from `linkReferenceDefinition` nodes.
 */

import type { CstNode } from '../nodes';

/**
 * Normalize a link label per CommonMark §4.7:
 * strip leading/trailing whitespace, collapse internal whitespace runs to
 * a single space, lowercase. BMP-only — full Unicode case-fold deferred
 * until reported.
 */
export function normalizeLinkLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

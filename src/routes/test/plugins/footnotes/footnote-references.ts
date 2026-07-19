/**
 * The reference-rendering seam. `[^label]` cannot be a first-class inline kind
 * (the `[` trigger is reserved — see the wall log), so it renders as a view-only
 * decoration source instead: pure over the document, re-run on every edit, one
 * superscript-number replace island per reference. The literal bytes stay in the
 * tree, so round-trip and GFM portability are untouched.
 */

import type { DecorationSource } from '$lib/plugin';
import { footnoteReferenceDecorations } from './footnote-numbering';

export function footnoteReferenceSource(): DecorationSource {
	return {
		name: 'footnote-references',
		provide: (document) => footnoteReferenceDecorations(document)
	};
}

/**
 * How one editor reads its own bytes: its grammar, its document's link-reference definitions and
 * its presentation mode. The editor builds one and every internal parse, reparse and join cleanup
 * takes it whole, so no read can pair this editor's bytes with another reading's parts.
 * The resolver and the mode change while the editor lives: read them at use, never copy them.
 */

import type { LinkReferenceResolver } from '../core/inline/link-reference-resolver';
import type { PresentationMode } from '../presentation-mode';
import type { GrammarView } from './block-openers';

export interface Reading {
	/** The block and inline syntax this editor switched on, plugins included. */
	readonly grammar: GrammarView;
	/** Resolves reference links against the document's link-reference definitions; rebuilt after
	 *  each commit, absent with no definitions. */
	readonly resolver: LinkReferenceResolver | undefined;
	/** The definitions' fingerprint, which the inline cache compares. */
	readonly resolverSignature: string;
	/** Bumped with each rebuild of the resolver: a small key for render memos. */
	readonly resolverEpoch: number;
	mode(): PresentationMode;
	/** Whether the caret's block draws no delimiters, where a rewrite may drop bytes nobody saw. */
	hidesDelimitersAtCaret(): boolean;
}

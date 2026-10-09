/**
 * The conformance cell for an inline-menu source's commit, published at
 * `@voithos-labs/aragonite/testing`. A commit that waits (a fetch, a picker) can outlive the note
 * it was picked in: this holds one across a `source` swap and fails if it still writes.
 */

import { parse } from '../core/parser';
import type { DocumentView } from '../core/node-views';
import { createDraftRegistry } from '../components/draft-registry';
import { createDocumentStamps } from '../editor-actions/commit/document-stamp';
import { openPick } from '../inline-menu/pick-context';
import type { InlineMenuItem, InlineMenuSource } from '../inline-menu/types';
import type { EditorContext } from '../schema/plugin-install';

export interface InlineMenuCommitCase {
	/** Builds the source from the per-editor context, as a plugin's `onEditor` callback does. */
	source(editor: EditorContext): InlineMenuSource;
	/** The row the author picks. */
	item: InlineMenuItem;
	/** What was typed after the trigger; empty by default. */
	query?: string;
	/** Lets the commit's own wait finish; the cell calls it once the swap has landed. */
	release(): void;
}

/** Picks `item`, swaps the document while the commit waits, releases it, and throws if the commit
 *  wrote anything after the swap, through the context `onCommit` hands it or its own. */
export async function checkInlineMenuCommitAcrossSwap(c: InlineMenuCommitCase): Promise<void> {
	const writes: string[] = [];
	const stamps = createDocumentStamps();
	const drafts = createDraftRegistry(stamps);
	const host = { generation: 0, document: parse('\n') };
	const editor = recordingContext(writes, drafts.open, host);
	const source = c.source(editor);
	const query = c.query ?? '';
	const range = { query, path: [0], start: 0, end: source.trigger.length + query.length };
	const pick = openPick(editor, drafts);
	const committed = source.onCommit?.(c.item, range, pick.editor);
	stamps.retire();
	drafts.closeAll('document-swap');
	// What a real swap changes, so a source that compares the generation across its wait sees it.
	host.generation++;
	host.document = parse('another note\n');
	const before = writes.length;
	c.release();
	try {
		await committed;
	} finally {
		pick.end();
	}
	const late = writes.slice(before);
	if (late.length > 0) {
		throw new Error(
			`inline-menu source '${source.name}': its commit wrote ${late.join(', ')} after the host ` +
				`loaded another document; write through the context onCommit hands you, or compare ` +
				`documentGeneration across the wait`
		);
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

/** An editor context that records each write and reads `host` live; the rest answers as an empty
 *  editor would. */
function recordingContext(
	writes: string[],
	openDraft: EditorContext['openDraft'],
	host: { generation: number; document: DocumentView }
): EditorContext {
	return {
		editorId: 'inline-menu-conformance',
		get document() {
			return host.document;
		},
		get documentGeneration() {
			return host.generation;
		},
		events: { on: () => () => {} },
		options: undefined,
		decorations: { addSource: () => ({ invalidate() {}, dispose() {} }) },
		rects: {
			blockRect: () => null,
			rangeRects: () => [],
			caretRect: () => null,
			reveal: async () => false,
			scrollTo: async () => false,
			navigateTo: async () => false
		},
		inlineMenus: {
			addSource: () => ({ dispose() {} }),
			open: () => false,
			close() {},
			isOpen: false
		},
		insertCatalogue: [],
		insertMarkdown: async (md: string) => (
			writes.push(`insertMarkdown(${JSON.stringify(md)})`),
			true
		),
		runCommand: (commandId: string) => (writes.push(`runCommand(${commandId})`), true),
		openDraft,
		computeInlineContent: () => [],
		presentationMode: 'source',
		theme: 'light',
		isActivationClick: () => false
	};
}

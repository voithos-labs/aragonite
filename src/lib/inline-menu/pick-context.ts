/**
 * What a pending pick holds: a draft of the document it was made in, and the `EditorContext` its
 * commit writes through. A `source` swap drops the draft, which aborts the signal and makes the
 * context's writes refuse; every other member reads through to the owner's context, live.
 */

import type { Draft, DraftSpec } from '../schema/drafts';
import type { EditorContext } from '../schema/plugin-install';
import type { InlineMenuCommit } from './types';

export interface PendingPick {
	editor: InlineMenuCommit;
	/** Call once the commit settles: the editor stops closing the pick from then on. */
	end(): void;
}

export function openPick(
	owner: EditorContext,
	drafts: { open(spec: DraftSpec): Draft }
): PendingPick {
	const aborted = new AbortController();
	const draft = drafts.open({
		close: (cause) => {
			if (cause === 'document-swap') aborted.abort();
		}
	});
	return { editor: pickContext(owner, draft, aborted.signal), end: draft.end };
}

// Object.create, never a spread: `document` and the other getters must keep reading live.
function pickContext(
	owner: EditorContext,
	draft: Pick<Draft, 'stale'>,
	signal: AbortSignal
): InlineMenuCommit {
	const insertMarkdown: EditorContext['insertMarkdown'] = (md, options) =>
		draft.stale ? Promise.resolve(false) : owner.insertMarkdown(md, options);
	const runCommand: EditorContext['runCommand'] = (commandId, arg) =>
		!draft.stale && owner.runCommand(commandId, arg);
	return Object.create(owner, {
		insertMarkdown: { value: insertMarkdown },
		runCommand: { value: runCommand },
		signal: { value: signal }
	});
}

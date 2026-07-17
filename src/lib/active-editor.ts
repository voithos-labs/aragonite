/**
 * The editor instance a document-level chord routes to when no editor is focused.
 *
 * Each editor's document-level keydown handler owns undo/redo, plugin-global
 * chords, and cross-block motion for the case where the caret's block windowed out
 * and native focus dropped to `<body>` — a target shared by every editor on the
 * page. Two mounted editors would otherwise both act on one such keypress; this
 * records the editor the user last interacted with so exactly one claims it. Focus
 * landing inside an editor (`focusin`) marks it; unmount relinquishes the claim.
 *
 * Module-level (page-shared) by design — the whole point is cross-instance
 * coordination. Not a registry: last-write-wins mutable state, no register-once.
 */
let lastInteracted: HTMLElement | null = null;

export function markEditorInteracted(root: HTMLElement): void {
	lastInteracted = root;
}

export function isLastInteractedEditor(root: HTMLElement): boolean {
	return lastInteracted === root;
}

/** Release the claim if this editor holds it, so a torn-down instance never keeps it. */
export function releaseInteractedEditor(root: HTMLElement): void {
	if (lastInteracted === root) lastInteracted = null;
}

/** Test-only: reset the shared claim between cases. */
export function __resetActiveEditorForTests(): void {
	lastInteracted = null;
}

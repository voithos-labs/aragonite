/**
 * Which editor a document-level chord routes to when no block holds native focus.
 *
 * Each editor's document-level keydown handler owns undo/redo, plugin-global
 * chords, cross-block motion, and the search shortcuts for the case where focus is
 * not inside the editor — the caret's block windowed out (or was never placed) to
 * `<body>`, or a sibling control (a toolbar toggle) holds focus. The keydown
 * listener sees every editor's keystrokes on the page, so `claimsBodyChord`
 * resolves the single claimant:
 *
 *   - the editor the user last interacted with, when that claim is still live
 *     (`focusin` marks it; its editor still mounted); else
 *   - the sole mounted editor — a lone editor always claims its own body chords,
 *     even before first focus (a never-focused or windowed-out Ctrl+F / Ctrl+Z).
 *
 * Two mounted editors with no live claim resolve to neither: the target is
 * ambiguous, and guessing drives the wrong instance.
 *
 * Module-level (page-shared) by design — the whole point is cross-instance
 * coordination. `mountedEditors` is lifecycle-managed (register on mount,
 * unregister on unmount); `lastInteracted` is last-write-wins.
 */
const mountedEditors = new Set<HTMLElement>();
let lastInteracted: HTMLElement | null = null;

export function registerEditor(root: HTMLElement): void {
	mountedEditors.add(root);
}

export function unregisterEditor(root: HTMLElement): void {
	mountedEditors.delete(root);
}

export function markEditorInteracted(root: HTMLElement): void {
	lastInteracted = root;
}

/**
 * True when a body-level chord routes to `root`: the live last-interacted editor,
 * or — when no live claim exists — the sole mounted one.
 */
export function claimsBodyChord(root: HTMLElement): boolean {
	if (lastInteracted === root) return true;
	const hasLiveClaim = lastInteracted !== null && mountedEditors.has(lastInteracted);
	return !hasLiveClaim && mountedEditors.size === 1 && mountedEditors.has(root);
}

/** Release the claim if this editor holds it, so a torn-down instance never keeps it. */
export function releaseInteractedEditor(root: HTMLElement): void {
	if (lastInteracted === root) lastInteracted = null;
}

/** Test-only: clear both the claim and the mounted set between cases. */
export function __resetActiveEditorForTests(): void {
	lastInteracted = null;
	mountedEditors.clear();
}

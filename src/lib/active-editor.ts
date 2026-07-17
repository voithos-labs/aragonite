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

// Text-like <input> types the reserved chords yield to. Checkbox/radio/button/
// file/range/color and the date-family are deliberately absent: they don't consume
// Ctrl+F, so a sole editor keeps claiming when one holds focus — the
// presentation-reading toggle is such a checkbox. Unknown/missing type normalizes
// to "text" (HTMLInputElement.type), so a bare <input> lands here.
const TEXT_ENTRY_INPUT_TYPES = new Set([
	'text',
	'search',
	'url',
	'email',
	'tel',
	'password',
	'number'
]);

/**
 * True when `active` is a text-entry surface outside every mounted editor — a
 * foreign `<textarea>`, text-like `<input>`, or `contenteditable` host the user is
 * typing in. The reserved UI chords (Ctrl+F / Ctrl+H) yield to it, so a sole/last-
 * interacted editor never hijacks a page-global Find from a consumer's own field.
 */
export function isForeignTextEntry(active: Element | null): boolean {
	if (!isTextEntrySurface(active)) return false;
	for (const root of mountedEditors) {
		if (root.contains(active)) return false;
	}
	return true;
}

function isTextEntrySurface(el: Element | null): boolean {
	if (el instanceof HTMLTextAreaElement) return true;
	if (el instanceof HTMLInputElement) return TEXT_ENTRY_INPUT_TYPES.has(el.type);
	return el?.matches('[contenteditable]:not([contenteditable="false"])') ?? false;
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

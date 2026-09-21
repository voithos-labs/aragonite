/**
 * Which editor a document-level chord goes to when no block has focus. The keydown listener
 * sees every editor's keystrokes on the page, so it goes to the last editor the user touched
 * while that one is still mounted, otherwise to the only mounted editor. Two mounted editors
 * and no recent one resolve to neither, since guessing drives the wrong instance.
 * Module-level on purpose: coordinating across instances is the point.
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

/** True when a body-level chord routes to `root`. */
export function claimsBodyChord(root: HTMLElement): boolean {
	if (lastInteracted === root) return true;
	const hasLiveClaim = lastInteracted !== null && mountedEditors.has(lastInteracted);
	return !hasLiveClaim && mountedEditors.size === 1 && mountedEditors.has(root);
}

// Text-like <input> types the reserved chords yield to. Non-text types are deliberately
// absent: they don't consume Ctrl+F, so a lone editor keeps taking it while one has focus.
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
 * True when `active` is a text-entry element outside every mounted editor. The reserved
 * chords (Ctrl+F, Ctrl+H) yield to it, so an editor never hijacks a consumer's own field.
 */
export function isForeignTextEntry(active: Element | null): boolean {
	if (!isTextEntrySurface(active)) return false;
	for (const root of mountedEditors) {
		if (root.contains(active)) return false;
	}
	return true;
}

/** True when `el` takes text input: the elements a programmatic focus move must yield to. */
export function isTextEntrySurface(el: Element | null): boolean {
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

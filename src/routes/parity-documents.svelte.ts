/**
 * Every mounted editor's current document, exposed for the e2e teardown container-parity walk
 * (`src/lib/e2e/container-parity.ts`). The test hook `window.__test` can only point at one
 * editor, so every route that mounts an `<Editor>` calls `trackParityDocument` and the walk
 * covers every document on the page rather than whichever one the hook points at.
 */

export interface ParityDocument {
	children?: unknown[];
}

// `bind:this` gives `null` on unmount and `undefined` before mount, so the check before
// registering must reject both.
type EditorHandle = { __test: { getDocument(): ParityDocument } } | null | undefined;

const PARITY_DOCUMENTS_KEY = '__parityDocuments';

type ParityWindow = Window & { [PARITY_DOCUMENTS_KEY]?: Array<() => ParityDocument> };

/**
 * The editor arrives through a getter, never a value: a bound ref is `undefined` until
 * the component mounts, and a captured value would freeze that.
 */
export function trackParityDocument(getEditor: () => EditorHandle): void {
	$effect(() => {
		const editor = getEditor();
		if (!editor || typeof window === 'undefined') return;
		const target = window as ParityWindow;
		const registry = (target[PARITY_DOCUMENTS_KEY] ??= []);
		const getDocument = () => editor.__test.getDocument();
		registry.push(getDocument);
		return () => {
			const at = registry.indexOf(getDocument);
			if (at !== -1) registry.splice(at, 1);
		};
	});
}

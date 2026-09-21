/**
 * Editor-root focus attribution: which block host holds the caret. The path tells each
 * windowing list which block to keep mounted, so a scroll that pushes the caret off-screen
 * never tears down native focus or the IME; both preview modes' CSS keys the focused block's
 * markers off the `data-focused` attribute. The installing `$effect`s stay in `Editor.svelte`.
 */

import { assertInvariant } from '../assert';
import { checkLandableCaret } from '../invariants/landable-caret';
import { isPreviewMode, type PresentationMode } from '../presentation-mode';
import { readBlockPath } from '../selection/path-lookup';
import { onRoot, removeAll } from './editor-root-listeners';

export interface FocusAttributionDeps {
	/** A getter, never a value: every attribute write is gated on the mode in force. */
	get mode(): PresentationMode;
}

export interface FocusAttribution {
	/** `root` is the element the installing effect captured, not a live binding. */
	install(root: HTMLElement): () => void;
	/** Entering a preview mode marks the already-focused block, since no re-focus fires. */
	applyForMode(): void;
	getFocusedPath(): number[] | null;
}

export function createFocusAttribution(deps: FocusAttributionDeps): FocusAttribution {
	// Plain fields, never reactive: focusout fires mid-teardown during a structural commit,
	// where a reactive write would trip state_unsafe_mutation.
	let focusedPath: number[] | null = null;
	let focusedHostEl: HTMLElement | null = null;

	// Only in preview modes, so source and reading DOM stay byte-identical.
	function applyFocusedAttr(): void {
		if (focusedHostEl && isPreviewMode(deps.mode)) {
			focusedHostEl.setAttribute('data-focused', '');
		} else {
			focusedHostEl?.removeAttribute('data-focused');
		}
	}

	function setFocusedHost(host: HTMLElement | null): void {
		if (focusedHostEl === host) return;
		focusedHostEl?.removeAttribute('data-focused');
		focusedHostEl = host;
		applyFocusedAttr();
	}

	function clear(): void {
		focusedPath = null;
		setFocusedHost(null);
	}

	function install(root: HTMLElement): () => void {
		const onFocusIn = (e: FocusEvent) => {
			const host = (e.target as Element | null)?.closest('[data-block-path]');
			if (!host || !root.contains(host)) {
				clear();
				return;
			}
			setFocusedHost(host as HTMLElement);
			const path = readBlockPath(host);
			focusedPath = path && path.length > 0 ? path : null;
			// Every way of placing a caret focuses its editable element, whoever wrote the code,
			// so a consumer's own caret placement is checked here too (G1.33).
			const landed = e.target;
			if (landed instanceof HTMLElement) {
				assertInvariant('landable-caret', () => checkLandableCaret(landed, deps.mode, path ?? []));
			}
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks: keep the focused path
			clear();
		};
		return removeAll(onRoot(root, 'focusin', onFocusIn), onRoot(root, 'focusout', onFocusOut));
	}

	return {
		install,
		applyForMode: applyFocusedAttr,
		getFocusedPath: () => focusedPath
	};
}

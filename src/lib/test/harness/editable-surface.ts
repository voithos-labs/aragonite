// Shared editable-surface harness for composition/input contract tests.

import {
	createEditableSurface,
	type EditableSurfaceDeps
} from '$lib/components/blocks/editable-surface';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';

export interface SurfaceHarness {
	surface: ReturnType<typeof createEditableSurface>;
	/** Recorded by the default commitInput; empty when a custom one is passed. */
	commits: Array<{ text: string; preEdit: number; saved: number }>;
	el: HTMLElement;
	setCaret: (offset: number) => void;
}

/**
 * A real contenteditable behind the surface skeleton, so `readText` is honest DOM
 * readback: a test simulates the IME by assigning `el.textContent`, exactly what
 * the browser hands the input funnel. The caret is a settable cell because jsdom
 * has none. Only the two context reads the composition path touches are real —
 * the rest is constructed but never invoked.
 */
export function makeSurface(
	commitInput?: EditableSurfaceDeps['commitInput'],
	relocateComposedText?: EditableSurfaceDeps['relocateComposedText']
): SurfaceHarness {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	document.body.appendChild(el);

	let caret = 0;
	let composing = false;
	let preEditOffset = 0;
	const commits: SurfaceHarness['commits'] = [];

	const deps = {
		getEl: () => el,
		getAmbientLength: () => 0,
		backend: { getRaw: () => asRawOffset(caret), setRaw: () => {}, buildRange: () => null },
		getMyPath: () => [0],
		getIndex: () => 0,
		getComposing: () => composing,
		setComposing: (value: boolean) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset: number) => {
			preEditOffset = offset;
		},
		setPendingCursor: () => {},
		selection: { isCrossBlock: false },
		stickyColumn: { reset: () => {} },
		edgeAffinity: { reset: () => {}, get: () => null, note: () => {}, noteTyping: () => {} },
		focusActions: { revealPath: async () => null },
		getDoc: () => null,
		getBlockElByPath: () => null,
		getEditorRoot: () => null,
		getEditorLifetime: () => null,
		containerEdit: {},
		blockEdit: {},
		controller: {},
		history: {},
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		linkRef: undefined,
		onCommandError: undefined,
		getKeybindingOverrides: () => ({}),
		pasteCoordinator: {},
		getFocusOffset: () => null,
		getTextLen: () => (el.textContent ?? '').length,
		readText: () => el.textContent ?? '',
		relocateComposedText,
		commitInput:
			commitInput ??
			((text: string, preEdit: number, saved: number) => {
				commits.push({ text, preEdit, saved });
			})
	} as unknown as EditableSurfaceDeps;

	return {
		surface: createEditableSurface(deps),
		commits,
		el,
		setCaret: (offset) => {
			caret = offset;
		}
	};
}

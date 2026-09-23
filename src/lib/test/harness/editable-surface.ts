// Shared harness for the composition and input contract tests on an editable block.

import {
	createEditableSurface,
	type EditableSurfaceDeps
} from '$lib/components/blocks/editable-surface';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';

export interface SurfaceHarness {
	surface: ReturnType<typeof createEditableSurface>;
	/** Recorded by the default commitInput; empty when a custom one is passed. */
	commits: Array<{ text: string; preEdit: number; saved: number }>;
	/** Every raw offset the editable element wrote through `backend.setRaw`, in order. */
	seats: number[];
	el: HTMLElement;
	setCaret: (offset: number) => void;
}

/**
 * A real contenteditable behind the harness, so `readText` reads the DOM honestly: a test
 * simulates the IME by assigning `el.textContent`, which is exactly what the browser hands the
 * input path. The caret is a settable value because jsdom has none. Only the two context reads
 * the composition path touches are real; the rest is built but never called. `presentationMode`
 * mounts the block under a root marked with that mode, which is where the traversal that finds
 * caret positions reads it.
 */
export function makeSurface(
	commitInput?: EditableSurfaceDeps['commitInput'],
	relocateComposedText?: EditableSurfaceDeps['relocateComposedText'],
	options: {
		presentationMode?: string;
		handleBeforeInput?: EditableSurfaceDeps['handleBeforeInput'];
	} = {}
): SurfaceHarness {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	if (options.presentationMode) {
		const root = document.createElement('div');
		root.setAttribute('data-presentation', options.presentationMode);
		root.appendChild(el);
		document.body.appendChild(root);
	} else {
		document.body.appendChild(el);
	}

	let caret = 0;
	let composing = false;
	const commits: SurfaceHarness['commits'] = [];
	const seats: number[] = [];

	const deps = {
		getEl: () => el,
		getAmbientLength: () => 0,
		backend: {
			getRaw: () => asRawOffset(caret),
			setRaw: (offset: number) => {
				seats.push(offset);
			},
			buildRange: () => null
		},
		getMyPath: () => [0],
		getIndex: () => 0,
		getComposing: () => composing,
		setComposing: (value: boolean) => {
			composing = value;
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
		handleBeforeInput: options.handleBeforeInput,
		commitInput:
			commitInput ??
			((text: string, preEdit: number, saved: number) => {
				commits.push({ text, preEdit, saved });
			})
	} as unknown as EditableSurfaceDeps;

	return {
		surface: createEditableSurface(deps),
		commits,
		seats,
		el,
		setCaret: (offset) => {
			caret = offset;
		}
	};
}

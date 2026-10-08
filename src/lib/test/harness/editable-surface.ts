// Shared harness for the composition and input contract tests on an editable block.

import {
	createEditableSurface,
	type EditableSurfaceDeps
} from '$lib/components/blocks/editable-surface';
import type { BlockEditActions } from '$lib/action-contracts';
import type { NodeView } from '$lib/core/node-views';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import { createSurfaceBackend } from '$lib/cursor/surface-backend';
import { rawOffsetAt, type CaretClamp } from '$lib/cursor/widget-offset';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { fixtureReading } from './fixture-grammar';
import { stubBlockEdit, stubCaretMemory } from '$lib/testing/headless-actions';
import type { CaretMemory } from '$lib/cursor/caret-memory';
import { commandContext } from '../support/command-context';

export interface SurfaceHarness {
	surface: ReturnType<typeof createEditableSurface>;
	/** Every content write, as the block's list received it; empty when a real `blockEdit` is passed. */
	commits: Array<{ text: string; preEdit: number; saved: number | undefined }>;
	/** Where each `backend.setRaw` put the caret, read back as a raw offset, in order. */
	seats: number[];
	el: HTMLElement;
	setCaret: (offset: number) => void;
}

/** An editable block over a real contenteditable: a test assigns `el.textContent` as an IME does,
 *  and sets the caret by hand since jsdom has none. The block is an empty last line by default. */
export function makeSurface(
	options: {
		compositionSeat?: EditableSurfaceDeps['compositionSeat'];
		presentationMode?: string;
		handleBeforeInput?: EditableSurfaceDeps['handleBeforeInput'];
		handleKeydown?: EditableSurfaceDeps['handleKeydown'];
		/** Inert by default; pass a real memory to see what an input does to it. */
		caretMemory?: CaretMemory;
		blockEdit?: BlockEditActions;
		getNode?: () => NodeView;
		/** Real collaborators in place of the stubs, for a block wired to a live document. */
		overrides?: Partial<EditableSurfaceDeps>;
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
	const writer = createSurfaceBackend({ getEl: () => el });
	const recording: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (_index, text, _mode, preEdit, saved) => {
			commits.push({ text, preEdit, saved });
			return withStoredCaret(Promise.resolve(true), saved ?? preEdit);
		}
	};

	const deps = {
		getEl: () => el,
		backend: {
			getRaw: () => asRawOffset(caret),
			setRaw: (offset: RawOffset, placement: { clamp: CaretClamp }) => {
				writer.setRaw(offset, placement);
				const sel = window.getSelection();
				seats.push(sel?.focusNode ? rawOffsetAt(el, sel.focusNode, sel.focusOffset) : offset);
			}
		},
		getNode: options.getNode ?? (() => ({ kind: 'paragraph', leadingTrivia: '', raw: '' })),
		getMyPath: () => [0],
		getIndex: () => 0,
		getComposing: () => composing,
		setComposing: (value: boolean) => {
			composing = value;
		},
		requestCaret: () => {},
		selection: { isCrossBlock: false },
		caretMemory: options.caretMemory ?? stubCaretMemory(),
		kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
		focusActions: {},
		caretLanding: { mount: async () => null },
		getDoc: () => ({ kind: 'document', prefix: '', children: [], suffix: '' }),
		getBlockElByPath: () => null,
		scrollOwner: { place: () => ({ scroll: async () => true }) },
		getEditorRoot: () => null,
		getEditorLifetime: () => null,
		containerEdit: {},
		blockEdit: options.blockEdit ?? recording,
		controller: { endContinuedBurst: () => {} },
		history: {},
		getPresentationMode: () => 'source' as const,
		reading: fixtureReading(),
		commands: commandContext(),
		pasteCoordinator: {},
		getFocusOffset: () => null,
		getTextLen: () => (el.textContent ?? '').length,
		readText: () => el.textContent ?? '',
		compositionSeat: options.compositionSeat,
		handleKeydown: options.handleKeydown ?? (async () => {}),
		handleBeforeInput: options.handleBeforeInput,
		...options.overrides
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

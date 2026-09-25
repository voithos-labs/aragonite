// The standard editor context a block component reads when mounted on its own, so a test can
// mount one block without listing everything the root provides, and only this file changes when a
// new required context appears. `overrides` takes a per-key value or part of a group's members.

import { vi } from 'vitest';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices
} from '$lib/editor-keys';
import type { BlockEditActions, ContainerEditActions, FocusActions } from '$lib/action-contracts';
import type { Document } from '$lib/core/nodes';
import type { DocumentView } from '$lib/core/node-views';
import { createDecorationEngine } from '$lib/decorations/decoration-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { createMenuPresence } from '$lib/components/menu/menu-presence.svelte';
import { defaultRegistryView } from '$lib/schema/registry-view';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { createEditorEvents } from '$lib/editor-events';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createRevealAnchorState } from '$lib/cursor/reveal-anchor';
import { createAutoPairRecord } from '$lib/components/blocks/text/auto-pair-record';
import { createHeightOracle } from '$lib/cursor/height-oracle';
import { createScrollport, type Scrollport } from '$lib/cursor/scrollport';
import { HEIGHT_ESTIMATES } from '$lib/cursor/typography-estimates';
import {
	makeStickyColumn,
	makeEdgeAffinity,
	makePendingMarks,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from './editor-actions';
import { fixtureReading } from './fixture-grammar';

interface HistoryStub {
	requestUndo: () => void;
	requestRedo: () => void;
}

export interface MountContextOverrides {
	blockEdit?: BlockEditActions;
	focus?: FocusActions;
	history?: HistoryStub;
	containerEdit?: ContainerEditActions;
	services?: Partial<EditorServices>;
	policies?: Partial<EditorPolicies>;
	/** Overrides one group; the document getter is the `doc` member (`doc: { doc: () => d }`). */
	doc?: Partial<EditorDoc>;
}

/** A member a bare mount actually calls is wired to its production factory, empty: a stub that
 *  answers only the members reached today breaks the moment a component reaches one more. The
 *  rest keep a `{}` cast. */
function stubbedServices(getDoc: () => DocumentView): EditorServices {
	const selection = createSelectionState();
	return {
		events: createEditorEvents(),
		// Real, not a cast: BlockHost and its overlays call four members of the decorations
		// service during mount, and one with no sources answers all of them honestly.
		decorations: createDecorationEngine({ getDoc }),
		selection,
		search: {} as EditorServices['search'],
		stickyColumn: makeStickyColumn(),
		edgeAffinity: makeEdgeAffinity(),
		pendingMarks: makePendingMarks(),
		autoPairs: createAutoPairRecord(),
		revealAnchor: createRevealAnchorState(),
		// Real: every keydown on an editable block asks it what is selected.
		widgetSelection: createWidgetSelectionState({ onSelect: () => {} }),
		selectedWidget: { range: () => null, clear: () => {} },
		// Real: a `link.openCard` keypress asks it to record a target, and the entry rule reads it
		// back. The checks mirror production, so a component test runs the ones it ships with.
		linkCard: createLinkCardState({
			onOpen: () => {},
			canOpen: () => !selection.isCrossBlock && window.getSelection()?.isCollapsed !== false,
			canEnter: () => !selection.isCrossBlock,
			canOpenCreate: () => !selection.isCrossBlock && window.getSelection()?.isCollapsed === false
		}),
		// A bare mount has no inline menu, so no block is ever a combobox.
		inlineMenuCombobox: () => null,
		// Real: a table or code block opening its menu counts itself in.
		menuPresence: createMenuPresence(),
		// The two members a format toggle reaches on a bare mount; the rest keep the cast.
		controller: {
			flushDebouncedCheckpoint: () => {},
			isolateUndoEntry: (write: () => void) => write()
		} as EditorServices['controller'],
		pasteCoordinator: {} as EditorServices['pasteCoordinator'],
		reorder: {} as EditorServices['reorder'],
		reorderAnnounce: () => {},
		registryView: defaultRegistryView,
		activePlugins: everyInstalledPlugin,
		rects: {} as EditorServices['rects'],
		// Real, and inert: a bare mount has no cross-block range, so every member answers no.
		crossBlockCommands: { canRun: () => false, run: () => false, isActive: () => false },
		// A bare mount has no announcer and no host to show a label on.
		kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} }
	};
}

function stubbedPolicies(): EditorPolicies {
	return {
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		imageLoadPolicy: () => 'auto',
		blockDragHandles: () => false,
		presentationMode: () => 'source',
		theme: () => 'dark',
		keybindingOverrides: () => ({ global: new Map(), byKind: new Map() }),
		onPasteImage: undefined,
		onRunCode: undefined,
		codeMenuItems: undefined,
		brokenImageUrls: new Set<string>()
	};
}

function stubbedDoc(emptyDoc: Document): EditorDoc {
	// Fresh on every read: a bare mount has no reactive graph to invalidate a
	// derived on, so "always a memo miss" is the only stub that can't hand a
	// consumer a stale answer. A test measuring memo hits supplies its own.
	let version = 0;
	return {
		doc: () => emptyDoc,
		contentVersion: () => ++version,
		reading: fixtureReading(),
		pluginEditor: (() => undefined) as unknown as EditorDoc['pluginEditor'],
		lifetime: new AbortController().signal,
		editorRoot: () => null,
		blockElLookup: () => null,
		focusedPath: () => null,
		// Real, not a cast: a windowed container (list, table) builds its height
		// table during init and would throw on a bare object.
		heightOracle: createHeightOracle({
			lineHeight: HEIGHT_ESTIMATES.proseLineHeight,
			codeLineHeight: HEIGHT_ESTIMATES.codeLineHeight,
			avgCharWidth: HEIGHT_ESTIMATES.avgCharWidth,
			blockChrome: HEIGHT_ESTIMATES.blockChrome,
			imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
		}),
		scrollHost: () => null,
		scrollport: () => null,
		correctsScroll: () => true,
		widthVersion: () => 0,
		viewportHeightVersion: () => 0
	};
}

/** Self mode's own wiring: an editor root supplied without a scroll container is the scroll
 *  container, so a harness that stubs scroll geometry on the root has windowing read it, as in
 *  production. */
function withDerivedScrollport(doc: EditorDoc): EditorDoc {
	if (doc.scrollport() !== null) return doc;
	let port: Scrollport | null = null;
	return {
		...doc,
		scrollport: () => {
			const el = doc.editorRoot();
			if (el && !port) port = createScrollport(el);
			return port;
		}
	};
}

export function editorMountContext(overrides: MountContextOverrides = {}): Map<symbol, unknown> {
	const emptyDoc: Document = { kind: 'document', prefix: '', children: [], suffix: '' };
	// The document group is assembled first, so services that read the document (decorations)
	// see the override rather than the empty placeholder.
	const policies: EditorPolicies = { ...stubbedPolicies(), ...overrides.policies };
	const docBase = stubbedDoc(emptyDoc);
	// The reading follows the services' grammar and the policies' mode unless a test supplies its own.
	docBase.reading = fixtureReading({
		get grammar() {
			return services.registryView.grammar;
		},
		mode: () => policies.presentationMode()
	});
	const doc: EditorDoc = withDerivedScrollport({ ...docBase, ...overrides.doc });
	const services: EditorServices = { ...stubbedServices(doc.doc), ...overrides.services };
	return new Map<symbol, unknown>([
		[BLOCK_EDIT_KEY, overrides.blockEdit ?? makeStubBlockEdit()],
		[FOCUS_KEY, overrides.focus ?? makeStubFocus()],
		[HISTORY_KEY, overrides.history ?? { requestUndo: vi.fn(), requestRedo: vi.fn() }],
		[CONTAINER_EDIT_KEY, overrides.containerEdit ?? makeStubContainerEdit()],
		[EDITOR_SERVICES_KEY, services],
		[EDITOR_POLICIES_KEY, policies],
		[EDITOR_DOC_KEY, doc]
	]);
}

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
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { createMenuPresence } from '$lib/components/menu/menu-presence.svelte';
import { createDraftRegistry } from '$lib/components/draft-registry';
import { createDocumentStamps } from '$lib/editor-actions/commit/document-stamp';
import { defaultRegistryView } from '$lib/schema/registry-view';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { createEditorEvents, emitCommandError } from '$lib/editor-events';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { coverRange, rangeCoverage } from '$lib/selection/range-coverage';
import { createScrollOwner } from '$lib/cursor/scroll-owner';
import { createAutoPairRecord } from '$lib/components/blocks/text/auto-pair-record';
import { createHeightOracle } from '$lib/cursor/height-oracle';
import { createListTree } from '$lib/reactivity/list-tree';
import { HEIGHT_ESTIMATES } from '$lib/cursor/typography-estimates';
import {
	makeCaretMemory,
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

/** A member a bare mount calls gets its empty production factory, since a partial stub breaks
 *  when a component reaches one more member; the rest keep a `{}` cast. */
function stubbedServices(getDoc: () => DocumentView): EditorServices {
	const selection = createSelectionState();
	const stamps = createDocumentStamps();
	return {
		events: createEditorEvents(),
		// Real, not a cast: BlockHost and its overlays call four members of the decorations
		// service during mount, and one with no sources answers all of them honestly.
		decorations: createDecorationEngine({ getDoc }),
		selection,
		rangeCoverage: () => null,
		search: {} as EditorServices['search'],
		caretMemory: makeCaretMemory(),
		autoPairs: createAutoPairRecord(),
		// Filled in by `editorMountContext`, which builds it over the document group's scroll host.
		scrollOwner: {} as EditorServices['scrollOwner'],
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
		// Filled in by `editorMountContext`, which reads the mode off the document group.
		menuPresence: {} as EditorServices['menuPresence'],
		stamps,
		drafts: createDraftRegistry(stamps),
		// The members a format toggle or a compositionend reaches on a bare mount; the rest keep the
		// cast.
		controller: {
			flushDebouncedCheckpoint: () => {},
			isolateUndoEntry: (write: () => void) => write(),
			endContinuedBurst: () => {}
		} as EditorServices['controller'],
		caretLanding: {} as EditorServices['caretLanding'],
		pasteCoordinator: {} as EditorServices['pasteCoordinator'],
		reorder: {} as EditorServices['reorder'],
		registryView: defaultRegistryView,
		activePlugins: everyInstalledPlugin,
		rects: {} as EditorServices['rects'],
		// Filled in by `editorMountContext`, which reads the other groups' overrides.
		commands: {} as EditorServices['commands'],
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
	// Fresh on every read: with no reactive graph to invalidate a memo, always missing is the only
	// answer that is never stale. A test measuring memo hits supplies its own.
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
		// No root list registers in a bare mount, so the tree holds nothing to read.
		listTree: createListTree({ getScrollTop: () => null, getFocusPath: () => null }),
		scrollHost: () => null,
		// Replaced by `editorMountContext` with the scroll owner's port.
		scrollport: () => null,
		widthVersion: () => 0,
		viewportHeightVersion: () => 0
	};
}

export function editorMountContext(overrides: MountContextOverrides = {}): Map<symbol, unknown> {
	const emptyDoc: Document = { kind: 'document', prefix: '', children: [], suffix: '' };
	// The document group is assembled first, so services that read the document (decorations)
	// see the override rather than the empty placeholder.
	const policies: EditorPolicies = { ...stubbedPolicies(), ...overrides.policies };
	const docBase = stubbedDoc(emptyDoc);
	// The reading follows the services' grammar and the policies' mode unless a test supplies its
	// own. The grammar is a getter because the services are built from the document below.
	docBase.reading = fixtureReading({
		get grammar() {
			return services.registryView.grammar;
		},
		mode: () => policies.presentationMode()
	});
	const doc: EditorDoc = { ...docBase, ...overrides.doc };
	const services: EditorServices = { ...stubbedServices(doc.doc), ...overrides.services };
	// An editor root given no scroll container is its own, as in production, so geometry a harness
	// stubs on the root is what windowing reads.
	services.scrollOwner =
		overrides.services?.scrollOwner ??
		createScrollOwner({
			getScrollHost: doc.editorRoot,
			editorCorrects: () => true,
			getBlockElByPath: doc.blockElLookup,
			getEditorRoot: doc.editorRoot,
			isHostScroll: () => false,
			getClipBounds: () => []
		});
	if (!overrides.doc?.scrollport) doc.scrollport = services.scrollOwner.port;
	// Real: a table or code block opening its menu counts itself in.
	services.menuPresence =
		overrides.services?.menuPresence ??
		createMenuPresence({ isReading: () => doc.reading.mode() === 'reading' });
	// Read off the selection the test handed in, the way the editor derives it.
	services.rangeCoverage =
		overrides.services?.rangeCoverage ??
		(() => {
			const { anchor, focus } = services.selection;
			if (!services.selection.isCustomRendered || !anchor || !focus) return null;
			return rangeCoverage(doc.doc(), coverRange(doc.doc(), anchor, focus));
		});
	const history = overrides.history ?? { requestUndo: vi.fn(), requestRedo: vi.fn() };
	// The editor's one command context, read from the groups above so a test's override of the
	// history, the policies or a service reaches every chord the block dispatches.
	services.commands = overrides.services?.commands ?? {
		history,
		pluginEditor: doc.pluginEditor,
		activation: services.activePlugins,
		getPresentationMode: () => doc.reading.mode(),
		isCrossBlockRange: () => services.selection.isCrossBlock,
		// Inert: a bare mount has no cross-block range, so every member answers no.
		crossBlockCommands: { canRun: () => false, run: () => false, isActive: () => false },
		keybindingOverrides: () => policies.keybindingOverrides(),
		onCommandError: (report) => emitCommandError(services.events, report),
		reorder: services.reorder
	};
	return new Map<symbol, unknown>([
		[BLOCK_EDIT_KEY, overrides.blockEdit ?? makeStubBlockEdit()],
		[FOCUS_KEY, overrides.focus ?? makeStubFocus()],
		[HISTORY_KEY, history],
		[CONTAINER_EDIT_KEY, overrides.containerEdit ?? makeStubContainerEdit()],
		[EDITOR_SERVICES_KEY, services],
		[EDITOR_POLICIES_KEY, policies],
		[EDITOR_DOC_KEY, doc]
	]);
}

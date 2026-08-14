// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
	createEditorRootKeydown,
	type EditorRootKeydownDeps
} from '$lib/components/editor-root-keydown';
import { registerEditor, __resetActiveEditorForTests } from '$lib/active-editor';
import {
	normalizeKeybindingOverrides,
	type KeybindingOverride
} from '$lib/schema/keybinding-overrides';
import type { PresentationMode } from '$lib/presentation-mode';
import type { SearchState } from '$lib/search/search-state.svelte';

// The bar's live surface, reduced to what the root handler drives. `isOpen`
// tracks open/close so the Escape arm and the savedRange guard see real state.
function fakeSearch() {
	const calls = { open: 0, close: 0, queries: [] as string[] };
	const state = {
		isOpen: false,
		open: () => {
			calls.open++;
			state.isOpen = true;
		},
		close: () => {
			calls.close++;
			state.isOpen = false;
		},
		setQuery: (q: string) => calls.queries.push(q)
	};
	return { state, calls };
}

interface Harness {
	root: HTMLElement;
	/** The `header` slot's box — host chrome mounted INSIDE the root. */
	header: HTMLElement;
	press(key: string, init?: KeyboardEventInit): KeyboardEvent;
	search: ReturnType<typeof fakeSearch>;
	crossBlockKeys: KeyboardEvent[];
	undoCount(): number;
	redoCount(): number;
	savedRanges: (Range | null)[];
	replaceExpanded: boolean[];
	setMode(mode: PresentationMode): void;
	setCrossBlock(on: boolean): void;
	setSearchBar(on: boolean): void;
	setOverrides(overrides: KeybindingOverride[] | undefined): void;
}

function harness(): Harness {
	const root = document.createElement('div');
	root.tabIndex = -1;
	document.body.append(root);
	const header = document.createElement('div');
	root.append(header);

	const search = fakeSearch();
	const crossBlockKeys: KeyboardEvent[] = [];
	const savedRanges: (Range | null)[] = [];
	const replaceExpanded: boolean[] = [];
	let undoCount = 0;
	let redoCount = 0;
	let mode: PresentationMode = 'source';
	let crossBlock = false;
	let searchBar = true;
	let overrides: KeybindingOverride[] | undefined;

	const deps: EditorRootKeydownDeps = {
		get searchBarEnabled() {
			return searchBar;
		},
		get mode() {
			return mode;
		},
		get canReplace() {
			return mode !== 'reading';
		},
		get keybindingOverrides() {
			return normalizeKeybindingOverrides(overrides);
		},
		get isCrossBlock() {
			return crossBlock;
		},
		search: search.state as unknown as SearchState,
		history: { requestUndo: () => void undoCount++, requestRedo: () => void redoCount++ },
		pluginEditor: () => undefined as never,
		onCommandError: () => {},
		crossBlock: {
			handleKeyDown: (e) => {
				crossBlockKeys.push(e);
				return Promise.resolve(true);
			}
		},
		isHostChrome: (node) => !!node && header.contains(node),
		saveSearchRange: (range) => savedRanges.push(range),
		setReplaceExpanded: (expanded) => replaceExpanded.push(expanded)
	};

	const handler = createEditorRootKeydown(deps);
	return {
		root,
		header,
		press(key, init) {
			const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
			handler.handleKeyDown(event, root);
			return event;
		},
		search,
		crossBlockKeys,
		undoCount: () => undoCount,
		redoCount: () => redoCount,
		savedRanges,
		replaceExpanded,
		setMode: (next) => (mode = next),
		setCrossBlock: (on) => (crossBlock = on),
		setSearchBar: (on) => (searchBar = on),
		setOverrides: (next) => (overrides = next)
	};
}

const MOD_F: KeyboardEventInit = { ctrlKey: true };
const MOD_Z: KeyboardEventInit = { ctrlKey: true };

beforeEach(() => {
	__resetActiveEditorForTests();
	document.body.replaceChildren();
});

// ── Dispatch order ───────────────────────────────────────────────────────────
// The arms are not commutative: the global-chord arm early-returns for everything
// below it, so a key an earlier arm claims is unreachable by a later one.

describe('editor-root keydown — dispatch order is load-bearing', () => {
	it('a search chord with focus INSIDE a block still opens the bar', () => {
		// The global-chord arm's focus gate is false here and returns for everything
		// below it, so moving the search arm under it drops Mod+F for every block.
		const h = harness();
		const block = document.createElement('div');
		block.contentEditable = 'true';
		block.tabIndex = 0;
		h.root.append(block);
		block.focus();
		expect(h.root.ownerDocument.activeElement).toBe(block);

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(1);
	});

	it('Escape with focus inside a block still closes an open bar', () => {
		const h = harness();
		const block = document.createElement('div');
		block.contentEditable = 'true';
		block.tabIndex = 0;
		h.root.append(block);
		block.focus();
		h.search.state.isOpen = true;

		const event = h.press('Escape');
		expect(h.search.calls.close).toBe(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('a search chord never reaches the cross-block dispatcher', () => {
		const h = harness();
		h.setCrossBlock(true);
		h.root.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(1);
		expect(h.crossBlockKeys).toEqual([]);
	});

	it('an editor-global chord never reaches the cross-block dispatcher', () => {
		const h = harness();
		h.setCrossBlock(true);
		h.root.focus();

		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
		expect(h.crossBlockKeys).toEqual([]);
	});

	it('an unclaimed key with a cross-block range falls through to the dispatcher', () => {
		const h = harness();
		h.setCrossBlock(true);
		h.root.focus();

		h.press('ArrowDown');
		expect(h.crossBlockKeys.map((e) => e.key)).toEqual(['ArrowDown']);
	});

	it('the cross-block arm stays silent on a collapsed caret', () => {
		const h = harness();
		h.root.focus();

		h.press('ArrowDown');
		expect(h.crossBlockKeys).toEqual([]);
	});
});

// ── The reading-mode arm (G4.19 arm 2) ───────────────────────────────────────

describe('editor-root keydown — reading-mode gate', () => {
	it('runs an editor-global command in source mode', () => {
		const h = harness();
		h.root.focus();

		const event = h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('dead-keys the same command in reading mode, still consuming the chord', () => {
		const h = harness();
		h.setMode('reading');
		h.root.focus();

		const event = h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(0);
		// The chord is owned either way — reading mode must not leak Mod+Z to the
		// browser's own undo over a contenteditable.
		expect(event.defaultPrevented).toBe(true);
	});

	it('reads the mode live, so a flip after construction takes effect', () => {
		const h = harness();
		h.root.focus();
		h.press('z', MOD_Z);
		h.setMode('reading');
		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
	});

	it('keeps find live in reading mode but collapses the replace row', () => {
		const h = harness();
		h.setMode('reading');
		h.root.focus();

		h.press('h', { ctrlKey: true });
		expect(h.search.calls.open).toBe(1);
		expect(h.replaceExpanded).toEqual([false]);
	});
});

// ── Consumer keybinding overrides ────────────────────────────────────────────

// Miss-analysis for the rebind case below: every override case here re-pointed a chord the
// BUILT-IN table already owned, so the arm's pre-gate answered true for reasons that had
// nothing to do with the override, and its override-blindness was invisible.
describe('editor-root keydown — global-scope binding resolution', () => {
	it('resolves the chord through a consumer override, not the built-in table', () => {
		const h = harness();
		h.setOverrides([{ chord: 'Mod+Z', command: 'history.redo' }]);
		h.root.focus();

		h.press('z', MOD_Z);
		expect(h.redoCount()).toBe(1);
		expect(h.undoCount()).toBe(0);
	});

	it('reads the override map live, so a prop change lands without reconstruction', () => {
		const h = harness();
		h.root.focus();

		h.press('z', MOD_Z);
		h.setOverrides([{ chord: 'Mod+Z', command: 'history.redo' }]);
		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
		expect(h.redoCount()).toBe(1);
	});

	it('a disabling override leaves the chord consumed but unbound', () => {
		const h = harness();
		h.setOverrides([{ chord: 'Mod+Z', command: null }]);
		h.root.focus();

		const event = h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(0);
		expect(h.redoCount()).toBe(0);
		// The arm still owns the chord — a disabled binding must not leak to the browser.
		expect(event.defaultPrevented).toBe(true);
	});

	it('runs a rebind onto a chord the built-in table does not own', () => {
		const h = harness();
		h.setOverrides([{ chord: 'Mod+J', command: 'history.undo' }]);
		h.root.focus();

		const event = h.press('j', { ctrlKey: true });
		expect(h.undoCount()).toBe(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves an unbound chord to the browser', () => {
		const h = harness();
		h.root.focus();

		const event = h.press('j', { ctrlKey: true });
		expect(h.undoCount()).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});
});

// ── The claimsBodyChord arm ──────────────────────────────────────────────────

describe('editor-root keydown — body-chord containment', () => {
	it('the sole registered editor claims a search chord with focus outside it', () => {
		const h = harness();
		registerEditor(h.root);
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(1);
	});

	it('an unregistered editor does not claim an outside-focus search chord', () => {
		const h = harness();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(0);
	});

	it('a second mounted editor cannot steal the claim', () => {
		const h = harness();
		const other = document.createElement('div');
		document.body.append(other);
		registerEditor(h.root);
		registerEditor(other);
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(0);
	});

	it('a global chord yields to any focused outside element, claim or not', () => {
		const h = harness();
		registerEditor(h.root);
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(0);
	});

	it('a global chord fires for the claimant when nothing is focused', () => {
		const h = harness();
		registerEditor(h.root);
		document.body.focus();

		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
	});
});

// ── Focused-element containment ──────────────────────────────────────────────
// The arm answers a caret with NO focused element, never "anything focused inside the
// root". A surface that holds focus — a block, or the gap caret's proxy — owns its own
// dispatch, and widening this arm would run every such chord twice.

describe('editor-root keydown — a focused surface inside the root owns its chords', () => {
	it('a global chord resolves nothing while a focusable child holds focus', () => {
		const h = harness();
		registerEditor(h.root);
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		h.root.append(surface);
		surface.focus();
		expect(h.root.ownerDocument.activeElement).toBe(surface);

		h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(0);
	});
});

// ── The isForeignTextEntry arm ───────────────────────────────────────────────

describe('editor-root keydown — foreign text-entry yields Find', () => {
	it.each([
		['textarea', () => document.createElement('textarea')],
		['text input', () => Object.assign(document.createElement('input'), { type: 'text' })]
	])('yields a claimed search chord to a foreign %s', (_label, make) => {
		const h = harness();
		registerEditor(h.root);
		const field = make();
		document.body.append(field);
		field.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(0);
	});

	it('still claims when the outside element is not a text-entry surface', () => {
		const h = harness();
		registerEditor(h.root);
		const field = Object.assign(document.createElement('input'), { type: 'checkbox' });
		document.body.append(field);
		field.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(1);
	});

	it('a text-entry surface INSIDE this editor is not foreign', () => {
		const h = harness();
		registerEditor(h.root);
		const field = document.createElement('input');
		field.type = 'text';
		h.root.append(field);
		field.focus();

		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(1);
	});
});

// ── The header slot ──────────────────────────────────────────────────────────
// `root.contains(active)` is true for host chrome, so the "focus is in this editor"
// claims read it as their own content and a host title field loses Find mid-typing.
// The discriminator is the slot: the same field one level up still claims.

describe('editor-root keydown — host chrome owns its own keystrokes', () => {
	it('yields a search chord to a text field in the header slot', () => {
		const h = harness();
		registerEditor(h.root);
		const field = document.createElement('input');
		field.type = 'text';
		h.header.append(field);
		field.focus();

		const event = h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});

	it('leaves an open bar alone on Escape from the slot', () => {
		const h = harness();
		const field = document.createElement('input');
		field.type = 'text';
		h.header.append(field);
		field.focus();
		h.search.state.isOpen = true;

		const event = h.press('Escape');
		expect(h.search.calls.close).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});
});

// ── Search-chord side effects ────────────────────────────────────────────────

describe('editor-root keydown — search chord arms', () => {
	it('Mod+H expands the replace row; Mod+F leaves it collapsed', () => {
		const h = harness();
		h.root.focus();

		h.press('h', { ctrlKey: true });
		h.press('f', MOD_F);
		expect(h.replaceExpanded).toEqual([true, false]);
	});

	it('snapshots the pre-search caret once, so a repeat Mod+F cannot clobber it', () => {
		const h = harness();
		h.root.focus();

		h.press('f', MOD_F);
		h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(2);
		expect(h.savedRanges).toHaveLength(1);
	});

	it('falls through when the find bar is disabled by prop', () => {
		const h = harness();
		h.setSearchBar(false);
		h.setCrossBlock(true);
		h.root.focus();

		const event = h.press('f', MOD_F);
		expect(h.search.calls.open).toBe(0);
		expect(event.defaultPrevented).toBe(false);
		expect(h.crossBlockKeys.map((e) => e.key)).toEqual(['f']);
	});

	it('Escape is inert while the bar is closed', () => {
		const h = harness();
		h.root.focus();

		const event = h.press('Escape');
		expect(h.search.calls.close).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});

	it('seeds the query from a live selection inside the editor', () => {
		const h = harness();
		const block = document.createElement('div');
		block.textContent = 'needle';
		h.root.append(block);
		h.root.focus();
		const range = document.createRange();
		range.selectNodeContents(block);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		h.press('f', MOD_F);
		expect(h.search.calls.queries).toEqual(['needle']);
	});
});

// ── Non-vacuity ──────────────────────────────────────────────────────────────

describe('editor-root keydown — the harness can observe a miss', () => {
	it('a plain key with no claim reaches nothing at all', () => {
		const h = harness();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		const event = h.press('a');
		expect(h.search.calls.open).toBe(0);
		expect(h.undoCount()).toBe(0);
		expect(h.crossBlockKeys).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});
});

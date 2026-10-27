// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
	createEditorRootKeydown,
	type EditorRootKeydownDeps
} from '#lib/components/editor-root/keydown.js';
import { registerEditor, __resetActiveEditorForTests } from '#lib/active-editor.js';
import {
	normalizeKeybindingOverrides,
	type KeybindingOverride
} from '#lib/schema/keybinding-overrides.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { SearchState } from '#lib/search/search-state.svelte.js';
import { commandContext } from '../harness/command-context';

// The search bar's live state, cut down to what the root handler drives. `isOpen`
// tracks open and closed so the Escape branch and the savedRange check see real state.
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
	/** The `header` snippet's box: the host's own header, mounted inside the root. */
	header: HTMLElement;
	/** The editor's find bar, mounted outside the root as a host's `searchBarAnchor` puts it. */
	findBar: HTMLElement;
	/** `handledBelow`: a handler under the root already took the key and prevented its default. */
	press(key: string, init?: KeyboardEventInit, handledBelow?: boolean): KeyboardEvent;
	search: ReturnType<typeof fakeSearch>;
	crossBlockKeys: KeyboardEvent[];
	/** Text the range's own type-to-replace path was handed, in order. */
	inserted: string[];
	undoCount(): number;
	redoCount(): number;
	searchCaretSaves(): number;
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
	const findBar = document.createElement('div');
	document.body.append(findBar);

	const search = fakeSearch();
	const crossBlockKeys: KeyboardEvent[] = [];
	const inserted: string[] = [];
	let searchCaretSaves = 0;
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
		get canReplace() {
			return mode !== 'reading';
		},
		get isCrossBlock() {
			return crossBlock;
		},
		search: search.state as unknown as SearchState,
		// No plugins are activated here, so every installed one is active.
		commands: commandContext({
			history: { requestUndo: () => void undoCount++, requestRedo: () => void redoCount++ },
			getPresentationMode: () => mode,
			keybindingOverrides: () => normalizeKeybindingOverrides(overrides)
		}),
		crossBlock: {
			handleKeyDown: (e) => {
				crossBlockKeys.push(e);
				return Promise.resolve(true);
			},
			insertText: (text) => {
				inserted.push(text);
				return Promise.resolve(true);
			}
		},
		isHostChrome: (node) => !!node && header.contains(node),
		isFindBar: (node) => !!node && findBar.contains(node),
		saveSearchCaret: () => searchCaretSaves++,
		setReplaceExpanded: (expanded) => replaceExpanded.push(expanded)
	};

	const handler = createEditorRootKeydown(deps);
	return {
		root,
		header,
		findBar,
		press(key, init, handledBelow = false) {
			const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
			if (handledBelow) event.preventDefault();
			handler.handleKeyDown(event, root);
			return event;
		},
		search,
		crossBlockKeys,
		inserted,
		undoCount: () => undoCount,
		redoCount: () => redoCount,
		searchCaretSaves: () => searchCaretSaves,
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
// The order matters: the global-chord branch returns early for everything below it,
// so a key an earlier branch takes can never reach a later one.

describe('editor-root keydown: dispatch order is required', () => {
	it('a search chord with focus inside a block still opens the bar', () => {
		// The global-chord branch's focus check is false here and returns for everything
		// below it, so moving the search branch under it drops Mod+F for every block.
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

	// A range over a block with no character position focuses the root, where no `beforeinput`
	// fires: without this branch the character reaches nothing and the range stays untouched.
	it('a printable key with a cross-block range goes to the range’s text entry point', () => {
		const h = harness();
		h.setCrossBlock(true);
		h.root.focus();

		const event = h.press('x');
		expect(h.inserted).toEqual(['x']);
		expect(h.crossBlockKeys).toEqual([]);
		expect(event.defaultPrevented).toBe(true);
	});

	it('a chorded or composing key is not text and keeps its own branch', () => {
		const h = harness();
		h.setCrossBlock(true);
		h.root.focus();

		h.press('b', { ctrlKey: true });
		h.press('x', { isComposing: true });
		expect(h.inserted).toEqual([]);
		expect(h.crossBlockKeys.map((e) => e.key)).toEqual(['b', 'x']);
	});

	it('the cross-block branch stays silent on a collapsed caret', () => {
		const h = harness();
		h.root.focus();

		h.press('ArrowDown');
		expect(h.crossBlockKeys).toEqual([]);
	});
});

// ── Reading mode ─────────────────────────────────────────────────────────────

describe('editor-root keydown, reading-mode gate', () => {
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
		// The chord is taken either way: reading mode must not let Mod+Z through to
		// the browser's own undo over a contenteditable.
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

// Miss-analysis: every override case re-pointed a chord the built-in table already owned.
describe('editor-root keydown: global-scope binding resolution', () => {
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
		// It still takes the chord: a disabled binding must not reach the browser.
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

// ── claimsBodyChord ──────────────────────────────────────────────────────────

describe('editor-root keydown: body-chord containment', () => {
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
// The root answers only a caret with no focused element: a focused block or gap caret handles
// its own chords, and widening the root's check would run each such chord twice.

describe('editor-root keydown: focus inside the root', () => {
	function focusChild(h: Harness, el: HTMLElement): void {
		h.root.append(el);
		el.focus();
		expect(h.root.ownerDocument.activeElement).toBe(el);
	}

	it('a focused surface that took the chord keeps it, so it never runs twice', () => {
		const h = harness();
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		focusChild(h, surface);
		h.press('z', MOD_Z, true);
		expect(h.undoCount()).toBe(0);
	});

	it('a text field inside the editor keeps its own Mod+Z', () => {
		const h = harness();
		focusChild(h, document.createElement('input'));
		const event = h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});

	it('a focused chrome button runs the editor undo, with the default prevented', () => {
		const h = harness();
		focusChild(h, document.createElement('button'));
		const event = h.press('z', MOD_Z);
		expect(h.undoCount()).toBe(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("the find bar's button outside the root runs the editor undo; its field keeps its own", () => {
		const h = harness();
		const button = document.createElement('button');
		const field = document.createElement('input');
		h.findBar.append(button, field);
		button.focus();
		expect(h.press('z', MOD_Z).defaultPrevented).toBe(true);
		field.focus();
		expect(h.press('z', MOD_Z).defaultPrevented).toBe(false);
		expect(h.undoCount()).toBe(1);
	});

	it('a focused chrome button takes no text or motion for a cross-block range', () => {
		const h = harness();
		h.setCrossBlock(true);
		focusChild(h, document.createElement('button'));
		h.press('a');
		h.press('ArrowDown', { shiftKey: true });
		expect(h.inserted).toEqual([]);
		expect(h.crossBlockKeys).toEqual([]);
	});
});

// ── isForeignTextEntry ───────────────────────────────────────────────────────

describe('editor-root keydown: foreign text-entry yields Find', () => {
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

	it('a text-entry surface inside this editor is not foreign', () => {
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

// ── The host's header ────────────────────────────────────────────────────────
// `root.contains(active)` is true for the host's header too, so a host title field would lose
// Find while typed in; only the header element tells the two apart.

describe('editor-root keydown: host chrome owns its own keystrokes', () => {
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

describe('editor-root keydown: search chord branches', () => {
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
		expect(h.searchCaretSaves()).toBe(1);
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

	// Miss-analysis: the seeding row selected one line, and Firefox on Windows writes a line break as CRLF.
	it('seeds the query with LF line breaks, whatever the engine wrote', () => {
		const h = harness();
		const block = document.createElement('div');
		block.textContent = 'one\r\ntwo';
		h.root.append(block);
		h.root.focus();
		const range = document.createRange();
		range.selectNodeContents(block);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		h.press('f', MOD_F);
		expect(h.search.calls.queries).toEqual(['one\ntwo']);
	});
});

// ── Backspace keeps the page ─────────────────────────────────────────────────

// Miss-analysis: the Backspace guard's rows pressed it on a block only, never on a field that
// deletes on it, so a plugin's date input losing its Backspace went unseen.
describe('editor-root keydown: Backspace leaves the page only to a field', () => {
	const input = (type?: string) => () => {
		const el = document.createElement('input');
		if (type) el.type = type;
		return el;
	};
	const editable = () => {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		// jsdom focuses no editable on its own.
		el.tabIndex = 0;
		return el;
	};
	const block = () => {
		const el = document.createElement('div');
		el.tabIndex = -1;
		return el;
	};
	const rows: [string, 'root' | 'find bar' | 'page', () => HTMLElement, boolean][] = [
		['a block with no caret (reading mode)', 'root', block, true],
		['a chrome button', 'root', () => document.createElement('button'), true],
		['an editable block', 'root', editable, false],
		["the find bar's field", 'find bar', input(), false],
		["the image's alt field or the link card's URL", 'root', input('text'), false],
		["a plugin's textarea", 'root', () => document.createElement('textarea'), false],
		["a plugin's date input", 'root', input('date'), false],
		["the host's own input", 'page', input('text'), false],
		["the host's own button", 'page', () => document.createElement('button'), false]
	];

	for (const [name, where, make, prevented] of rows) {
		it(`${name}: ${prevented ? 'the default is cancelled' : 'the key keeps its default'}`, () => {
			const h = harness();
			registerEditor(h.root);
			const el = make();
			({ root: h.root, 'find bar': h.findBar, page: document.body })[where].append(el);
			el.focus();
			expect(document.activeElement).toBe(el);

			expect(h.press('Backspace').defaultPrevented).toBe(prevented);
		});
	}

	it('with nothing focused, only the editor holding body chords cancels it', () => {
		const h = harness();
		expect(h.press('Backspace').defaultPrevented).toBe(false);
		registerEditor(h.root);
		expect(h.press('Backspace').defaultPrevented).toBe(true);
	});
});

// ── Non-vacuity ──────────────────────────────────────────────────────────────

describe('editor-root keydown: the harness can observe a miss', () => {
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

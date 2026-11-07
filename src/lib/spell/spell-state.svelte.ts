/**
 * One editor's spell check: a decoration source that underlines the misspelled words of the
 * mounted blocks, a cache of the checker's verdicts so each distinct word is asked once, and the
 * word-level reads and writes the menus make. The word the caret is typing in stays plain until
 * the caret leaves it, so a half-typed word never flickers red.
 */

import { tick } from 'svelte';
import type { DocumentView, NodeView } from '../core/node-views';
import { isProseKind } from '../core/inline';
import { resolvedInlineContent, type InlineReading } from '../core/inline/inline-cache';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { pathKey } from '../decorations/buckets';
import type {
	DecorationRegistry,
	DecorationSourceHandle,
	MarkDecoration,
	MarkInteractions
} from '../decorations/types';
import type { EditorEvents } from '../editor-events';
import type { EditorSelection, SelectionPoint } from '../selection/primitives';
import { spanAt, wordSpans, type WordSpan } from './words';
import type { SpellChecker, SpellcheckMode } from './types';

export const SPELL_SOURCE_NAME = 'editor:spellcheck';
export const SPELL_MARK_CLASS = 'spell-overlay';
/** Blocks checked per run, counted in leaves: a mounted window is far smaller, and a giant list
 *  whose items are all under one top-level block is checked this far and no further. */
const LEAF_CAP = 3000;
/** Distinct unknown words handed to the checker per run; the rest wait for the next run. */
const ASK_CAP = 5000;

/** A misspelled word: where it is (raw offsets in the block at `path`) and what it says. */
export interface Misspelling {
	path: number[];
	start: number;
	end: number;
	word: string;
}

/** The public spell-check controller, what `editor.getSpellcheck()` exposes. */
export interface SpellcheckState {
	readonly mode: SpellcheckMode;
	/** The misspelled word holding `offset` in the block at `path`, both bounds included, or null:
	 *  nothing there, a word still being checked, or a block that is not prose. */
	misspellingAt(path: readonly number[], offset: number): Misspelling | null;
	/** Replacements for a misspelled word, best first, empty for none; asked of the checker once
	 *  per word. */
	suggestionsFor(word: string): Promise<readonly string[]>;
	/** The suggestions already fetched for `word`, or null while they are on their way (the first
	 *  call starts the fetch). */
	peekSuggestions(word: string): readonly string[] | null;
	/** Rewrite the word as `replacement`, one undo entry, the caret landing after it. */
	replace(target: Misspelling, replacement: string): Promise<boolean>;
	/** Whether the checker takes new words, which is what puts "Add to dictionary" in the menus. */
	readonly canAddWord: boolean;
	/** Hand `word` to the checker and stop underlining it. */
	addWord(word: string): Promise<void>;
}

/** The editor's side of the controller: mode changes, the window moving, and teardown. */
export interface SpellState extends SpellcheckState {
	setMode(mode: SpellcheckMode): void;
	/** The mounted blocks changed under a scroll, so the marks cover a different set. */
	noteWindowChange(): void;
	dispose(): void;
}

export interface SpellStateDeps {
	getDoc: () => DocumentView;
	reading: InlineReading;
	decorations: DecorationRegistry;
	/** Null when the editor has none to ask, which leaves `'on'` with nothing to underline. */
	checker: SpellChecker | null;
	mode: SpellcheckMode;
	getSelection: () => EditorSelection | null;
	events: EditorEvents;
	/** The top-level blocks mounted now, half-open, or null when every block is. */
	mountedRange: () => { start: number; end: number } | null;
	/** Splice `bytes` over `[start, end)` of the leaf at `path` as one undo entry, the caret landing
	 *  at `caretAfter`. */
	replaceRange: (
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	) => Promise<boolean>;
	/** Where a checker's throw or rejection goes; the word then counts as spelled right. */
	onError: (error: unknown) => void;
	/** The handlers each underlined word carries (the hover menu); absent, the marks are inert. */
	markInteractions?: (misspelling: Misspelling) => MarkInteractions;
}

interface LeafSpans {
	raw: string;
	spans: WordSpan[];
}

interface TypingWord {
	key: string;
	start: number;
	end: number;
}

export function createSpellState(deps: SpellStateDeps): SpellState {
	const { checker } = deps;
	let mode = $state<SpellcheckMode>(deps.mode);
	// Bumped as verdicts land and words are added, so a reader that derives from `misspellingAt`
	// (the selection toolbar) asks again.
	let version = $state(0);
	const verdicts = new Map<string, boolean>();
	const pending = new Set<string>();
	const suggestions = new Map<string, Promise<readonly string[]>>();
	const settled = new Map<string, readonly string[]>();
	const spansByLeaf = new WeakMap<NodeView, LeafSpans>();
	let typing: TypingWord | null = null;
	let handle: DecorationSourceHandle | null = null;
	let invalidateQueued = false;
	let live = true;

	// ── The source ───────────────────────────────────────────────────────────

	function provide(doc: DocumentView): MarkDecoration[] {
		if (mode !== 'on' || !checker) return [];
		const leaves = mountedLeaves(doc);
		const unknown = new Set<string>();
		for (const leaf of leaves) {
			for (const span of leaf.spans) if (!verdicts.has(span.word)) unknown.add(span.word);
		}
		// Asked before the marks are built, so a checker that answers at once paints in this run.
		if (unknown.size > 0) ask(unknown);
		const out: MarkDecoration[] = [];
		for (const leaf of leaves) {
			const key = pathKey(leaf.path);
			for (const span of leaf.spans) {
				if (verdicts.get(span.word) !== false) continue;
				if (typing && typing.key === key && typing.start === span.start) continue;
				const mark: MarkDecoration = {
					type: 'mark',
					path: leaf.path,
					start: span.start,
					end: span.end,
					class: SPELL_MARK_CLASS
				};
				if (deps.markInteractions) {
					mark.interactive = deps.markInteractions({ ...span, path: leaf.path });
				}
				out.push(mark);
			}
		}
		return out;
	}

	function mountedLeaves(doc: DocumentView): { path: number[]; spans: WordSpan[] }[] {
		const range = deps.mountedRange() ?? { start: 0, end: doc.children.length };
		const out: { path: number[]; spans: WordSpan[] }[] = [];
		const visit = (node: NodeView, path: number[]): void => {
			if (out.length >= LEAF_CAP) return;
			const children = node.children;
			if (children && children.length > 0) {
				children.forEach((child, i) => visit(child, [...path, i]));
				return;
			}
			if (!isProseKind(node.kind)) return;
			out.push({ path, spans: spansOf(node) });
		};
		for (let i = range.start; i < range.end && i < doc.children.length; i++) {
			visit(doc.children[i], [i]);
		}
		return out;
	}

	/** The block's words, re-read only when its bytes changed. */
	function spansOf(node: NodeView): WordSpan[] {
		const held = spansByLeaf.get(node);
		if (held && held.raw === node.raw) return held.spans;
		const spans = wordSpans(node.raw, resolvedInlineContent(node, deps.reading));
		spansByLeaf.set(node, { raw: node.raw, spans });
		return spans;
	}

	function ask(words: Set<string>): void {
		if (!checker) return;
		let asked = 0;
		for (const word of words) {
			if (pending.has(word)) continue;
			if (asked++ >= ASK_CAP) return;
			let answer: boolean | Promise<boolean>;
			try {
				answer = checker.check(word);
			} catch (error) {
				settle(word, true, error);
				continue;
			}
			if (typeof answer === 'boolean') {
				verdicts.set(word, answer);
				continue;
			}
			pending.add(word);
			answer.then(
				(ok) => settle(word, ok),
				(error: unknown) => settle(word, true, error)
			);
		}
	}

	function settle(word: string, ok: boolean, error?: unknown): void {
		pending.delete(word);
		if (!live) return;
		if (error !== undefined) deps.onError(error);
		verdicts.set(word, ok);
		version++;
		scheduleInvalidate();
	}

	// One re-run after the current turn for however many verdicts land in it; a run from inside
	// `provide` must wait as well, since the registry is mid-run.
	function scheduleInvalidate(): void {
		if (invalidateQueued) return;
		invalidateQueued = true;
		void tick().then(() => {
			invalidateQueued = false;
			handle?.invalidate();
		});
	}

	function register(): void {
		if (handle || !checker) return;
		handle = deps.decorations.addSource({ name: SPELL_SOURCE_NAME, provide });
	}

	function unregister(): void {
		handle?.dispose();
		handle = null;
	}

	// ── The word being typed ─────────────────────────────────────────────────

	const offEdit = deps.events.on('edit', (event) => {
		if (event.op !== 'input') {
			typing = null;
			return;
		}
		const focus = charPoint(deps.getSelection()?.focus);
		if (!focus || pathKey(focus.path) !== pathKey(event.path)) {
			typing = null;
			return;
		}
		const node = blockNodeAt(deps.getDoc(), focus.path);
		const span = node && !node.children ? spanAt(spansOf(node), focus.offset) : null;
		typing = span ? { key: pathKey(focus.path), start: span.start, end: span.end } : null;
	});

	const offSelection = deps.events.on('selectionChange', (selection) => {
		if (!typing) return;
		const focus = charPoint(selection?.focus);
		if (
			focus &&
			pathKey(focus.path) === typing.key &&
			focus.offset >= typing.start &&
			focus.offset <= typing.end
		) {
			return;
		}
		typing = null;
		scheduleInvalidate();
	});

	const offSwap = deps.events.on('sourceSwap', () => {
		typing = null;
	});

	// ── Reads and writes for the menus ───────────────────────────────────────

	function misspellingAt(path: readonly number[], offset: number): Misspelling | null {
		void version;
		if (mode !== 'on' || !checker) return null;
		const node = blockNodeAt(deps.getDoc(), path);
		if (!node || node.children || !isProseKind(node.kind)) return null;
		const span = spanAt(spansOf(node), offset);
		if (!span) return null;
		const verdict = verdicts.get(span.word);
		if (verdict === undefined) ask(new Set([span.word]));
		if (verdict !== false) return null;
		return { path: [...path], start: span.start, end: span.end, word: span.word };
	}

	function suggestionsFor(word: string): Promise<readonly string[]> {
		const held = suggestions.get(word);
		if (held) return held;
		const fetched = (async () => {
			try {
				return checker ? await checker.suggest(word) : [];
			} catch (error) {
				deps.onError(error);
				return [];
			}
		})().then((list) => {
			settled.set(word, list);
			return list;
		});
		suggestions.set(word, fetched);
		return fetched;
	}

	if (deps.mode === 'on') register();

	return {
		get mode() {
			return mode;
		},
		misspellingAt,
		suggestionsFor,
		peekSuggestions(word) {
			const held = settled.get(word);
			if (held) return held;
			void suggestionsFor(word);
			return null;
		},
		replace(target, replacement) {
			return deps.replaceRange(
				target.path,
				target.start,
				target.end,
				replacement,
				target.start + replacement.length
			);
		},
		get canAddWord() {
			return !!checker?.addWord;
		},
		async addWord(word) {
			if (!checker?.addWord) return;
			try {
				await checker.addWord(word);
			} catch (error) {
				deps.onError(error);
			}
			// Every casing of the word is asked again, since the checker now knows it.
			const lower = word.toLowerCase();
			for (const held of [...verdicts.keys()]) {
				if (held.toLowerCase() === lower) verdicts.delete(held);
			}
			version++;
			scheduleInvalidate();
		},
		setMode(next) {
			if (next === mode) return;
			mode = next;
			if (next === 'on') register();
			else unregister();
		},
		noteWindowChange: scheduleInvalidate,
		dispose() {
			live = false;
			offEdit();
			offSelection();
			offSwap();
			unregister();
		}
	};
}

/** A character endpoint's path and offset; null for a table's cell endpoint, which is a cell index. */
function charPoint(point: SelectionPoint | undefined): { path: number[]; offset: number } | null {
	if (!point || 'cellCoordinate' in point) return null;
	return { path: point.path, offset: point.offset };
}

/**
 * One editor's inline-menu registry and the single session it can hold open. The session is
 * identity only (source name, path, trigger start); the query and the replaced range are re-read
 * from the live leaf after every edit and caret move, so nothing here can address bytes that moved.
 */

import { tick } from 'svelte';
import { isProseKind } from '../core/inline';
import { resolvedInlineContent } from '../core/inline/inline-cache';
import type { DocumentView, NodeView } from '../core/node-views';
import type { EditorError, EditorEvents } from '../editor-events';
import type { PresentationMode } from '../presentation-mode';
import type { EditorSelection } from '../selection/primitives';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import {
	findOpening,
	isProseOffset,
	isUnclosedDestination,
	sessionQuery,
	stepActive,
	typedRunStart,
	type InlineMenuSession
} from './inline-menu-session';
import type {
	InlineMenuItem,
	InlineMenuRegistry,
	InlineMenuSource,
	InlineMenuSourceHandle
} from './types';

export interface InlineMenuStateDeps {
	getDoc: () => DocumentView;
	getSelection: () => EditorSelection | null;
	getMode: () => PresentationMode;
	events: EditorEvents;
	/** This instance's id, so two editors on one page never give their lists the same DOM id. */
	editorId: string;
	/** Splice `bytes` over `[start, end)` of the leaf at `path` as one undo entry. */
	commitRange: (
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	) => Promise<void>;
	/** Land the caret at a raw offset, so the next keystroke addresses the document. */
	landCaret: (path: number[], offset: number) => Promise<boolean>;
}

export interface InlineMenuState {
	registry: InlineMenuRegistry;
	/** The open session's raw range and list, or null. Reactive. */
	getOpen(): InlineMenuOpenView | null;
	/** The list element's DOM id, which `aria-controls` names. */
	readonly listboxId: string;
	/** The DOM id of the row a source gave this item id, which `aria-activedescendant` names. */
	optionId(itemId: string): string;
	/** What the editable at `path` must say about the list showing in it, or null when none is.
	 *  The editable renders these itself; nothing writes onto its element. Reactive. */
	comboboxFor(path: readonly number[]): InlineMenuCombobox | null;
	move(delta: 1 | -1): void;
	setActive(index: number): void;
	/** Take a baseline for the caret's leaf if none is held; the host calls it at beforeinput,
	 *  before the input's bytes exist. */
	primeBaseline(): void;
	/** Commit the active row, or the row at `index`. False with no row to commit. */
	commit(index?: number): boolean;
	close(): void;
	dispose(): void;
}

/** The ids a focused editable points a screen reader at while an inline menu's list shows in it. */
export interface InlineMenuCombobox {
	listboxId: string;
	activeOptionId: string;
}

export interface InlineMenuOpenView {
	source: InlineMenuSource;
	path: number[];
	start: number;
	end: number;
	query: string;
	items: InlineMenuItem[];
	activeIndex: number;
}

/**
 * An item id as one token, since an attribute naming a DOM id can hold no whitespace and a
 * source is free to hand out `Meeting notes`. Every escape is reversible, so two ids a source
 * kept distinct never become one id in the page.
 */
function asIdToken(id: string): string {
	return id.replace(/[^A-Za-z0-9-]/gu, (char) => `_${char.codePointAt(0)!.toString(16)}_`);
}

export function createInlineMenuState(deps: InlineMenuStateDeps): InlineMenuState {
	const sources = new Map<string, InlineMenuSource>();
	const listboxId = `${deps.editorId}-inline-menu`;
	// A row is named after its own item, not its place in the list, so the row a narrower query
	// leaves active keeps the id the attribute pointing at it already held.
	const optionId = (itemId: string) => `${listboxId}-${asIdToken(itemId)}`;

	let session = $state.raw<InlineMenuSession | null>(null);
	let query = $state('');
	let end = $state(0);
	let items = $state.raw<InlineMenuItem[]>([]);
	let activeIndex = $state(0);

	let pendingRead: AbortController | null = null;
	/**
	 * The caret's leaf as the last read saw it. A trigger is the difference from these bytes, so a
	 * caret that merely arrives beside an existing `#` has typed nothing and opens nothing.
	 */
	let seen: { path: string; raw: string } | null = null;
	/** Set once a read has been held back, so the next change a caret cannot explain is adopted. */
	let heldBack = false;
	/** True across a write of this menu's own, whose bytes are not the author's typing. */
	let writing = false;
	let scheduled = false;
	let disposed = false;

	function report(error: unknown, source: string): void {
		const payload: EditorError = { origin: 'subscriber', error, context: { source } };
		deps.events.emit('error', payload);
	}

	/** The collapsed caret in a prose leaf, with that leaf: the only place a session lives. */
	function caretLeaf(): { path: number[]; offset: number; leaf: NodeView } | null {
		const selection = deps.getSelection();
		if (!selection) return null;
		const { anchor, focus } = selection;
		if (anchor.cellCoordinate || focus.cellCoordinate) return null;
		if (anchor.offset !== focus.offset || anchor.path.join() !== focus.path.join()) return null;
		const leaf = nodeAt(deps.getDoc(), focus.path);
		if (leaf === null || !isBlockNode(leaf) || !isProseKind(leaf.kind)) return null;
		return { path: focus.path, offset: focus.offset, leaf };
	}

	function nodeRaw(path: number[]): string {
		const leaf = nodeAt(deps.getDoc(), path);
		return leaf !== null && isBlockNode(leaf) ? leaf.raw : '';
	}

	function close(): void {
		pendingRead?.abort();
		pendingRead = null;
		if (session === null) return;
		session = null;
		items = [];
		query = '';
		activeIndex = 0;
	}

	/**
	 * The list with at most one row per id. Two rows under one id are one row to the render, which
	 * keys on it, so the later one is dropped and the source told rather than left to misdraw.
	 */
	function uniqueRows(list: InlineMenuItem[], source: string): InlineMenuItem[] {
		const ids = new Set<string>();
		const kept: InlineMenuItem[] = [];
		for (const row of list) {
			if (ids.has(row.id)) continue;
			ids.add(row.id);
			kept.push(row);
		}
		if (kept.length !== list.length) {
			report(
				new Error(
					`inlineMenus: source '${source}' offered rows sharing an id; all but the first ` +
						`of each were dropped`
				),
				source
			);
		}
		return kept;
	}

	function read(source: InlineMenuSource, live: InlineMenuSession): void {
		pendingRead?.abort();
		const controller = new AbortController();
		pendingRead = controller;
		const isCurrent = () => session === live && !controller.signal.aborted;
		const land = (next: InlineMenuItem[]) => {
			if (!isCurrent()) return;
			items = uniqueRows(next, source.name);
			activeIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
		};
		const fail = (error: unknown) => {
			if (!isCurrent()) return;
			report(error, source.name);
			land([]);
		};
		try {
			const result = source.items({
				query,
				path: live.path,
				start: live.start,
				end,
				signal: controller.signal
			});
			// A synchronous list lands in this same turn, so a fast source never paints a frame
			// of the previous query's rows.
			if (Array.isArray(result)) land(result);
			else result.then(land, fail);
		} catch (error) {
			fail(error);
		}
	}

	function evaluate(): void {
		if (disposed) return;
		// An editor nobody registered a menu on pays nothing per keystroke.
		if (sources.size === 0 && session === null) return;
		const caret = deps.getMode() === 'reading' ? null : caretLeaf();
		const previous = seen;
		seen = caret ? { path: caret.path.join(), raw: caret.leaf.raw } : null;

		if (session !== null) {
			const live = session;
			const source = sources.get(live.source);
			if (!caret || !source || caret.path.join() !== live.path.join()) return close();
			const next = sessionQuery(live, source, caret.leaf.raw, caret.offset);
			if (next === null) return close();
			if (next === query && caret.offset === end) return;
			query = next;
			end = caret.offset;
			activeIndex = 0;
			read(source, live);
			return;
		}

		if (writing || !caret || !previous || previous.path !== caret.path.join()) return;
		const from = typedRunStart(previous.raw, caret.leaf.raw, caret.offset);
		if (from === null) {
			// The bytes and the caret do not always move as one, so a read can land between them.
			// Holding the older snapshot for one more read lets the caret that follows explain the
			// change; a change it still cannot explain is adopted, so `seen` never goes stale.
			const unexplained = previous.raw !== caret.leaf.raw;
			if (unexplained && !heldBack) seen = previous;
			heldBack = unexplained && !heldBack;
			return;
		}
		heldBack = false;
		const opening = findOpening(sources.values(), caret.leaf.raw, caret.offset, from);
		if (!opening) return;
		if (!isProseOffset(resolvedInlineContent(caret.leaf), opening.start)) return;
		if (isUnclosedDestination(caret.leaf.raw, opening.start)) return;
		begin(opening.source, caret.path, opening.start, caret.offset);
	}

	/**
	 * Fill in a baseline for a leaf that has none: a caret reaches one with no read in between (a
	 * click into a list item, Enter onto a new line), and the first keystroke there would have
	 * nothing to be the difference from. Only ever fills a missing baseline, because within a
	 * burst the standing one still predates the trigger and must not be advanced past it.
	 */
	function primeBaseline(): void {
		if (disposed || sources.size === 0 || session !== null || writing) return;
		const caret = deps.getMode() === 'reading' ? null : caretLeaf();
		if (!caret) return;
		const path = caret.path.join();
		if (seen?.path !== path) seen = { path, raw: caret.leaf.raw };
	}

	/** After a write of this menu's own: those bytes are not the author's typing. */
	function resnap(): void {
		const caret = caretLeaf();
		seen = caret ? { path: caret.path.join(), raw: caret.leaf.raw } : null;
	}

	function begin(source: InlineMenuSource, path: number[], start: number, caret: number): void {
		const typedQuery = sessionQuery(
			{ source: source.name, path, start, triggerLength: source.trigger.length },
			source,
			nodeRaw(path),
			caret
		);
		const live: InlineMenuSession = {
			source: source.name,
			path: [...path],
			start,
			triggerLength: source.trigger.length
		};
		session = live;
		// A burst can carry the query's first bytes in with the trigger.
		query = typedQuery ?? '';
		end = caret;
		activeIndex = 0;
		items = [];
		read(source, live);
	}

	// Evaluated a tick after the event, so an edit and the selectionchange beside it are one read.
	// The baseline is taken now rather than then, because those two can carry a caret's arrival in
	// a leaf no read has seen and the first bytes typed there together.
	function schedule(): void {
		if (disposed || (sources.size === 0 && session === null)) return;
		primeBaseline();
		if (scheduled) return;
		scheduled = true;
		void tick().then(() => {
			scheduled = false;
			evaluate();
		});
	}

	const unsubscribeEdit = deps.events.on('edit', schedule);
	const unsubscribeSelection = deps.events.on('selectionChange', schedule);
	const unsubscribeMode = deps.events.on('presentationModeChange', schedule);

	async function commitItem(item: InlineMenuItem): Promise<void> {
		const live = session;
		if (!live) return;
		const source = sources.get(live.source);
		const range = { query, path: [...live.path], start: live.start, end };
		close();
		// One leaf's raw must not hold a blank line: the tree would say one paragraph where a
		// reload reads two.
		if (/[\r\n]/.test(item.insert)) {
			report(
				new Error(
					`inlineMenus: source '${live.source}' offered an insert with a line break; a pick ` +
						`writes one line of inline bytes, and a block belongs in onCommit`
				),
				live.source
			);
			return;
		}
		const caretAfter = range.start + item.insert.length;
		// The write is this menu's own, not a keystroke: bytes ending in a trigger reopen nothing.
		writing = true;
		try {
			await deps.commitRange(range.path, range.start, range.end, item.insert, caretAfter);
			await deps.landCaret(range.path, caretAfter);
		} catch (error) {
			// Nobody is waiting on this write, so a refused one has to be reported here or vanish.
			report(error, live.source);
			return;
		} finally {
			writing = false;
			resnap();
		}
		try {
			source?.onCommit?.(item, range);
		} catch (error) {
			report(error, live.source);
		}
	}

	function open(name: string): boolean {
		const source = sources.get(name);
		if (!source || deps.getMode() === 'reading') return false;
		const caret = caretLeaf();
		if (!caret) return false;
		close();
		const start = caret.offset;
		const caretAfter = start + source.trigger.length;
		void (async () => {
			writing = true;
			try {
				await deps.commitRange(caret.path, start, start, source.trigger, caretAfter);
				await deps.landCaret(caret.path, caretAfter);
			} catch (error) {
				report(error, name);
				return;
			} finally {
				writing = false;
				resnap();
			}
			if (disposed || !sources.has(name)) return;
			begin(source, caret.path, start, caretAfter);
		})();
		return true;
	}

	const registry: InlineMenuRegistry = {
		addSource(source): InlineMenuSourceHandle {
			if (disposed) {
				throw new Error(
					`inlineMenus.addSource: this editor is gone, so source '${source.name}' would ` +
						`never open; add it from an onEditor callback and dispose it when that returns`
				);
			}
			if (sources.has(source.name)) {
				throw new Error(`inlineMenus.addSource: a source named '${source.name}' already exists`);
			}
			if (source.trigger === '' || /[\r\n]/.test(source.trigger)) {
				throw new Error(
					`inlineMenus.addSource: source '${source.name}' needs a trigger of one line that is ` +
						`not empty; an empty trigger would open on every keystroke`
				);
			}
			// Nothing read the leaf while no source was registered, so the baseline is from before
			// whatever was typed since; the next event takes a fresh one.
			if (sources.size === 0) {
				seen = null;
				heldBack = false;
			}
			sources.set(source.name, source);
			return {
				dispose: () => {
					if (sources.get(source.name) !== source) return;
					sources.delete(source.name);
					if (session?.source === source.name) close();
				}
			};
		},
		open,
		close,
		get isOpen() {
			return session !== null && items.length > 0;
		}
	};

	return {
		registry,
		listboxId,
		optionId,
		comboboxFor(path) {
			if (session === null || items.length === 0) return null;
			if (session.path.join() !== path.join()) return null;
			return { listboxId, activeOptionId: optionId(items[activeIndex].id) };
		},
		getOpen() {
			if (session === null) return null;
			const source = sources.get(session.source);
			if (!source) return null;
			return {
				source,
				path: session.path,
				start: session.start,
				end,
				query,
				items,
				activeIndex
			};
		},
		move(delta) {
			activeIndex = stepActive(activeIndex, delta, items.length);
		},
		setActive(index) {
			if (index >= 0 && index < items.length) activeIndex = index;
		},
		commit(index = activeIndex) {
			const item = items[index];
			if (!item) return false;
			void commitItem(item);
			return true;
		},
		close,
		primeBaseline,
		dispose() {
			disposed = true;
			close();
			sources.clear();
			unsubscribeEdit();
			unsubscribeSelection();
			unsubscribeMode();
		}
	};
}

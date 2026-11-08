/**
 * A drawn block focused whole (`edit: 'box'`): its focus, its keys and the hidden editing host
 * beside it, as the thematic break has them. A box whose drawing has an editing surface of its own
 * (`Drawn.focus`) takes the caret from a neighbour's arrow and gives it back at its edges.
 */
import { imeOwnsKey } from '../../browser/composition';
import { CURSOR_END, entryEdge, type BlockComponent } from '../../block-component';
import type { NodeView } from '../../core/node-views';
import { asEditorX, type EditorX } from '../../core/coordinate-spaces';
import { on } from 'svelte/events';
import type { Drawn } from '../../schema/drawing';
import { blockAccessibleName } from '../../a11y-strings';
import { viewportXOf } from '../../caret/sticky-measure';
import {
	dispatchWholeBlockGlobalChord,
	handleWholeBlockKeys
} from '../../editor-actions/container-block-component';
import { createWholeBlockInputProxy } from '../../editor-actions/whole-block-focus-surface.svelte';
import { placeCaret } from '../../selection/place-caret';
import { selectWholeDocument } from '../../selection/keyboard-extend';
import { wireSurfaceContexts } from '../blocks/editable/surface-wiring.svelte';

export interface DrawnBoxDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	getTarget(): HTMLElement | null;
	drawn(): Drawn<unknown> | null;
}

/** Call during component initialisation. */
export function createDrawnBox(deps: DrawnBoxDeps) {
	const wiring = wireSurfaceContexts();
	const { blockEdit, focusActions, caretMemory, caretWriter, selection } = wiring.deps;
	const { getDoc, getBlockElByPath, reading, commands, readingFocus, composition } = wiring.deps;
	const isReading = () => reading.mode() === 'reading';
	const focusEl = () => deps.drawn()?.dom ?? null;

	const inputProxy = createWholeBlockInputProxy({
		getBoxEl: () => deps.getTarget() ?? undefined,
		getFocusEl: () => focusEl() ?? undefined,
		isReading,
		getLabel: () => blockAccessibleName(deps.getNode()),
		holdTabStop: (proxy) => readingFocus.hold(proxy, deps.getPath),
		mint: (text) => blockEdit.insertParagraph(deps.getIndex() + 1, text),
		paste: (md) =>
			wiring.services.pasteAsBlocks(
				() => blockEdit.insertParagraph(deps.getIndex() + 1, ''),
				md,
				deps.getPath()
			),
		composition
	});

	function enter(at: Parameters<NonNullable<Drawn<unknown>['focus']>['enter']>[0]): void {
		const own = deps.drawn()?.focus;
		const el = focusEl();
		if (own) own.enter(at);
		else if (el) inputProxy.focus(el);
	}

	// The editor's start and end values name an edge; any other offset is one `offset()` gave.
	function parkCaret(offset: number): void {
		if (entryEdge(offset).child === 'first') enter({ edge: 'start', x: null });
		else if (offset === CURSOR_END) enter({ edge: 'end', x: null });
		else enter({ offset });
	}

	const blockApi: BlockComponent = {
		editable: false,
		focusable: true,
		focus: placeCaret(selection, caretWriter, parkCaret),
		parkCaret,
		getCursorOffset() {
			const target = deps.getTarget();
			if (!target?.contains(document.activeElement)) return null;
			return deps.drawn()?.focus?.offset() ?? 0;
		},
		focusAtColumn(x, from) {
			const target = deps.getTarget();
			const edge = from === 'above' ? 'start' : 'end';
			enter({ edge, x: target ? viewportXOf(target, asEditorX(x)) : null });
		},
		// No text to measure, so any range over it is its whole box.
		measurePartialRects(start, end) {
			const target = deps.getTarget();
			return end > start && target ? [target.getBoundingClientRect()] : [];
		}
	};

	function onKeydown(e: KeyboardEvent): void {
		if (imeOwnsKey(e)) return;
		const drawn = deps.drawn();
		if (!drawn || drawn.keep?.(e)) return;
		// In the drawing's own editing surface a plain key is the surface's (it leaves through
		// `ctx.leave`), while a chord still reaches the editor unless `keep` took it.
		const own = !!drawn.focus && e.target !== drawn.dom && drawn.dom.contains(e.target as Node);
		if (own && !(e.ctrlKey || e.metaKey || e.altKey)) return;
		const kind = deps.getNode().kind;
		if (dispatchWholeBlockGlobalChord(e, kind, commands)) return;
		if (wiring.dispatchChord(e, { kind, getPath: deps.getPath })) return;
		if (own) return;
		handleWholeBlockKeys(e, {
			getIndex: deps.getIndex,
			getRaw: () => deps.getNode().raw,
			blockEdit,
			focus: focusActions,
			isReading,
			selection,
			caretMemory,
			commandOf: (press) => wiring.resolveChord(press, kind),
			takesKey: inputProxy.takesKey,
			getPath: deps.getPath,
			containerChords: wiring.services.containerChords,
			selectDocument: () => selectWholeDocument(selection, caretWriter, getDoc(), getBlockElByPath)
		});
	}

	$effect(() => {
		const target = deps.getTarget();
		return target ? on(target, 'keydown', onKeydown) : undefined;
	});

	/** Hands the caret past `edge`; a column carries on as the one an up or down arrow keeps. */
	function leave(edge: 'start' | 'end', x: EditorX | null): void {
		if (x !== null) {
			caretMemory.forget();
			caretMemory.captureColumn(x);
		}
		const index = deps.getIndex();
		if (edge === 'start') {
			void focusActions.moveFocus(index - 1, x === null ? 'end' : { stickyColumnFrom: 'below' });
		} else {
			void focusActions.moveFocus(index + 1, x === null ? 'start' : { stickyColumnFrom: 'above' });
		}
	}

	return { blockApi, leave };
}

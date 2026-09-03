import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { parse } from '$lib/core/parser';
import {
	highlightOccurrencesPlugin,
	type HighlightOccurrencesOptions
} from '$lib/plugins/highlight-occurrences';
import { OCCURRENCE_CLASS } from '$lib/plugins/highlight-occurrences/occurrences';
import {
	onEditorCallbacks,
	type EditorContext,
	type OnEditorCallback,
	type PluginSetupContext
} from '$lib/schema/plugin-install';
import type { DecorationSource, EditorSelection, MarkDecoration } from '$lib/plugin';

function caret(path: number[], offset: number): EditorSelection {
	const point = { path, offset };
	return { anchor: point, focus: point };
}

const DOC = parse('cat sat cat\n');

function editorStub() {
	const invalidate = vi.fn();
	const dispose = vi.fn();
	// One unsubscribe per channel, so cleanup is asserted per subscription rather than
	// as a count a single shared mock could reach by unsubscribing one channel twice.
	const offSelection = vi.fn();
	const offEdit = vi.fn();
	let added: DecorationSource | undefined;
	let selectionHandler: ((sel: EditorSelection) => void) | undefined;
	let editHandler: ((event: { op: string }) => void) | undefined;

	const editor = {
		decorations: {
			addSource: (source: DecorationSource) => {
				added = source;
				// The engine runs a source the moment it registers; a stub that skips that
				// first provide cannot see what the source makes of the epoch it mounts on.
				source.provide(DOC, { editEpoch: 0 });
				return { invalidate, dispose };
			}
		},
		events: {
			on: (name: string, handler: (event: never) => void) => {
				if (name === 'selectionChange') {
					selectionHandler = handler as unknown as (sel: EditorSelection) => void;
					return offSelection;
				}
				editHandler = handler as unknown as (event: { op: string }) => void;
				return offEdit;
			}
		}
	} as unknown as EditorContext;

	return {
		editor,
		invalidate,
		dispose,
		offSelection,
		offEdit,
		source: () => added,
		fireSelection: (sel: EditorSelection) => selectionHandler?.(sel),
		fireEdit: (op: string) => editHandler?.({ op })
	};
}

function attach(options: HighlightOccurrencesOptions = {}) {
	let onEditor: OnEditorCallback | undefined;
	const setupCtx: PluginSetupContext = {
		onEditor: (cb) => {
			onEditor = cb;
		}
	};
	highlightOccurrencesPlugin(options).setup(setupCtx);
	if (!onEditor) throw new Error('plugin registered no onEditor callback');

	const stub = editorStub();
	return { ...stub, cleanup: onEditor(stub.editor) };
}

describe('highlightOccurrencesPlugin wiring', () => {
	it('registers one decoration source named for the plugin on attach', () => {
		const wired = attach();
		expect(wired.source()?.name).toBe('highlight-occurrences');
		expect(typeof wired.source()?.provide).toBe('function');
	});

	it('pushes the new selection into the source and invalidates on selectionChange', () => {
		const wired = attach();
		expect(wired.source()!.provide(DOC, { editEpoch: 0 })).toEqual([]); // no selection yet

		wired.fireSelection(caret([0], 0)); // caret on the first 'cat'
		expect(wired.invalidate).toHaveBeenCalledTimes(1);
		// The invalidate re-runs provide in the engine; here we call it directly to
		// prove the source now sees the word under the caret (setSelection was wired).
		const marks = wired.source()!.provide(DOC, { editEpoch: 0 }) as MarkDecoration[];
		expect(marks).toHaveLength(2);
		expect(marks[0].class).toBe(OCCURRENCE_CLASS);
	});

	it('disposes the source and unsubscribes from both channels on cleanup', () => {
		const wired = attach();
		expect(typeof wired.cleanup).toBe('function');
		wired.cleanup!();
		expect(wired.dispose).toHaveBeenCalledTimes(1);
		expect(wired.offSelection).toHaveBeenCalledTimes(1);
		expect(wired.offEdit).toHaveBeenCalledTimes(1);
	});

	it('holds the marks back while typing and paints them when the burst flushes', () => {
		const wired = attach();
		wired.fireSelection(caret([0], 0));
		expect(wired.source()!.provide(DOC, { editEpoch: 0 })).toHaveLength(2);

		// A keystroke: the epoch bumps with no `edit` event ahead of it.
		expect(wired.source()!.provide(DOC, { editEpoch: 1 })).toEqual([]);

		wired.fireEdit('input');
		expect(wired.invalidate).toHaveBeenCalledTimes(2); // the selection change, then the flush
		expect(wired.source()!.provide(DOC, { editEpoch: 1 })).toHaveLength(2);
	});

	it('reads a structural op as an immediate repaint, not a typing burst', () => {
		const wired = attach();
		wired.fireSelection(caret([0], 0));

		wired.fireEdit('paste');
		expect(wired.invalidate).toHaveBeenCalledTimes(1); // no second: the epoch bump repaints
		expect(wired.source()!.provide(DOC, { editEpoch: 1 })).toHaveLength(2);
	});

	// The scan seam is the plugin's only option; the memo it feeds is pinned at the
	// source level, so this asserts the threading and nothing beyond it.
	it('threads the onScan option into the source it mints', () => {
		const onScan = vi.fn();
		const wired = attach({ onScan });
		wired.source()!.provide(parse('cat sat cat\n'), { editEpoch: 0 });
		expect(onScan).toHaveBeenCalledTimes(1);
	});
});

describe('highlightOccurrencesPlugin through the install platform', () => {
	beforeEach(() => resetPluginPlatformForTests());
	afterEach(() => resetPluginPlatformForTests());

	// A unit installs once per process, so an author's suite reinstalls between cases: a
	// registration that skipped the reset seam throws here, and a duplicated onEditor call
	// misses the count.
	it('reinstalls across the reset seam, registering exactly one callback each time', () => {
		installPlugins([highlightOccurrencesPlugin()]);
		expect(onEditorCallbacks('highlight-occurrences')).toHaveLength(1);

		resetPluginPlatformForTests();
		installPlugins([highlightOccurrencesPlugin()]);
		expect(onEditorCallbacks('highlight-occurrences')).toHaveLength(1);
	});

	// One installed unit, two <Editor> instances: hoisting the source out of the onEditor
	// callback would let a caret in one editor decorate the other.
	it('mints an independent source per editor', () => {
		installPlugins([highlightOccurrencesPlugin()]);
		const [onEditor] = onEditorCallbacks('highlight-occurrences');
		const first = editorStub();
		const second = editorStub();
		onEditor(first.editor);
		onEditor(second.editor);

		first.fireSelection(caret([0], 0));
		expect(first.source()!.provide(DOC, { editEpoch: 0 })).toHaveLength(2);
		expect(second.source()!.provide(DOC, { editEpoch: 0 })).toEqual([]);
	});
});

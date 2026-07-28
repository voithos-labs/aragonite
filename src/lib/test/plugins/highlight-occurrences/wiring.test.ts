// The plugin's onEditor wiring: it registers one selection-driven decoration
// source on attach, invalidates it on selectionChange (having first pushed the new
// selection into the source), and disposes the source + unsubscribes on cleanup.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { OCCURRENCE_CLASS } from '$lib/plugins/highlight-occurrences/occurrences';
import type {
	EditorContext,
	OnEditorCallback,
	PluginSetupContext
} from '$lib/schema/plugin-install';
import type { DecorationSource, EditorSelection, MarkDecoration } from '$lib/plugin';

function caret(path: number[], offset: number): EditorSelection {
	const point = { path, offset };
	return { anchor: point, focus: point };
}

function attach() {
	let onEditor: OnEditorCallback | undefined;
	const setupCtx: PluginSetupContext = {
		onEditor: (cb) => {
			onEditor = cb;
		}
	};
	highlightOccurrencesPlugin().setup(setupCtx);
	if (!onEditor) throw new Error('plugin registered no onEditor callback');

	const invalidate = vi.fn();
	const dispose = vi.fn();
	const off = vi.fn();
	let added: DecorationSource | undefined;
	let selectionHandler: ((sel: EditorSelection) => void) | undefined;

	const editor = {
		decorations: {
			addSource: (source: DecorationSource) => {
				added = source;
				return { invalidate, dispose };
			}
		},
		events: {
			on: (name: string, handler: (sel: EditorSelection) => void) => {
				if (name === 'selectionChange') selectionHandler = handler;
				return off;
			}
		}
	} as unknown as EditorContext;

	const cleanup = onEditor(editor);
	return {
		cleanup,
		invalidate,
		dispose,
		off,
		source: () => added,
		fireSelection: (sel: EditorSelection) => selectionHandler?.(sel)
	};
}

describe('highlightOccurrencesPlugin wiring', () => {
	it('registers one decoration source named for the plugin on attach', () => {
		const wired = attach();
		expect(wired.source()?.name).toBe('highlight-occurrences');
		expect(typeof wired.source()?.provide).toBe('function');
	});

	it('pushes the new selection into the source and invalidates on selectionChange', () => {
		const wired = attach();
		const doc = parse('cat sat cat\n');
		expect(wired.source()!.provide(doc, { editEpoch: 0 })).toEqual([]); // no selection yet

		wired.fireSelection(caret([0], 0)); // caret on the first 'cat'
		expect(wired.invalidate).toHaveBeenCalledTimes(1);
		// The invalidate re-runs provide in the engine; here we call it directly to
		// prove the source now sees the word under the caret (setSelection was wired).
		const marks = wired.source()!.provide(doc, { editEpoch: 0 }) as MarkDecoration[];
		expect(marks).toHaveLength(2);
		expect(marks[0].class).toBe(OCCURRENCE_CLASS);
	});

	it('disposes the source and unsubscribes from events on cleanup', () => {
		const wired = attach();
		expect(typeof wired.cleanup).toBe('function');
		wired.cleanup!();
		expect(wired.dispose).toHaveBeenCalledTimes(1);
		expect(wired.off).toHaveBeenCalledTimes(1);
	});
});

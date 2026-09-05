// @vitest-environment jsdom
//
// Whether a whole-document `source` swap reaches the decoration engine can only be
// asked of the mounted component: the engine sees a swap and an edit as the same
// `getDoc()` read.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../blocks/editor-mount';
import {
	mountEditorOverProps,
	settlePropWrite,
	unmountEditorOverProps
} from '../harness/editor-over-props.svelte';
import type { DecorationSource, MarkDecoration } from '$lib/decorations/types';
import type { DecorationEngine } from '$lib/decorations/decoration-state.svelte';

interface SwapSeam {
	getDecorationEngine(): DecorationEngine;
	getContentVersion(): number;
}

beforeAll(installLayoutStubs);
afterEach(unmountEditorOverProps);

const mountEditor = (source: string) => mountEditorOverProps<SwapSeam>({ source });

/** Marks the document's LAST block — a path only the document it ran against has. */
function tailSource(seen: { blocks: number; epoch: number }[]): DecorationSource {
	return {
		name: 'tail',
		provide: (doc, ctx): MarkDecoration[] => {
			seen.push({ blocks: doc.children.length, epoch: ctx.editEpoch });
			return [{ type: 'mark', path: [doc.children.length - 1], start: 0, end: 1, class: 'x' }];
		}
	};
}

describe('a `source` prop swap signals the decoration engine', () => {
	it('re-provides every registered source against the new document', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n\nthree\n');
		const seen: { blocks: number; epoch: number }[] = [];
		editor.getDecorations().addSource(tailSource(seen));
		expect(seen).toEqual([{ blocks: 3, epoch: 0 }]);

		props.source = 'only\n';
		await settlePropWrite();

		expect(seen.at(-1)).toEqual({ blocks: 1, epoch: 1 });
	});

	// The buckets, not the counter: `runSource`'s idle-source guard skips reassignment on
	// an empty→empty run, so an epoch-only assertion would pass over a stale bucket.
	it('replaces the published buckets, leaving nothing at a path the new document lacks', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n\nthree\n');
		editor.getDecorations().addSource(tailSource([]));
		const engine = editor.__test.getDecorationEngine();
		expect(engine.marksForPath([2])).toHaveLength(1);

		props.source = 'only\n';
		await settlePropWrite();

		expect(engine.marksForPath([0])).toHaveLength(1);
		expect(engine.marksForPath([2])).toHaveLength(0);
	});

	// The perf contract: a document swap with nothing registered does no decoration work.
	it('skips the run entirely when no source is registered', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n');
		props.source = 'only\n';
		await settlePropWrite();
		expect(editor.__test.getDecorationEngine().sourceCount).toBe(0);

		// A source registered after the swap still provides against the swapped-in doc.
		const seen: { blocks: number; epoch: number }[] = [];
		editor.getDecorations().addSource(tailSource(seen));
		expect(seen).toEqual([{ blocks: 1, epoch: 0 }]);
	});
});

// The swap is the one byte-writing door that lives in the component rather than in the action
// bundles (G4.52); every other door is pinned headlessly in `reactivity/content-version-doors`.
describe('a `source` prop swap moves the content version', () => {
	it('announces the replaced document, and nothing when the prop is rewritten unchanged', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n');
		const before = editor.__test.getContentVersion();

		props.source = 'only\n';
		await settlePropWrite();
		const afterSwap = editor.__test.getContentVersion();
		expect(afterSwap).not.toBe(before);

		// The `source !== lastSource` guard: an identical prop write replaces no bytes.
		props.source = 'only\n';
		await settlePropWrite();
		expect(editor.__test.getContentVersion()).toBe(afterSwap);
	});
});

describe('an open find bar rescans against the swapped-in document', () => {
	it('clears a stale match count and its overlay decorations when the new document has none', async () => {
		const { editor, props } = mountEditor('alpha one\n\nalpha two\n\nalpha three\n');
		const search = editor.getSearch();
		search.open();
		search.setQuery('alpha');
		expect(search.matches).toHaveLength(3);

		props.source = 'nothing matches now\n';
		await settlePropWrite();

		expect(search.matches).toHaveLength(0);
		expect(search.matchesForPath([0])).toHaveLength(0);
	});

	it('rescans onto the new document’s matches when it has some', async () => {
		const { editor, props } = mountEditor('alpha one\n\nbeta two\n');
		const search = editor.getSearch();
		search.open();
		search.setQuery('alpha');
		expect(search.matches.map((m) => m.path)).toEqual([[0]]);

		props.source = 'beta only\n\nalpha here\n\nalpha again\n';
		await settlePropWrite();

		expect(search.matches.map((m) => m.path)).toEqual([[1], [2]]);
	});
});

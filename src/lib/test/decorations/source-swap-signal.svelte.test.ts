// @vitest-environment jsdom
//
// Whether a whole-document `source` swap reaches the decoration engine can only be
// asked of the mounted component: the engine sees a swap and an edit as the same
// `getDoc()` read.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { DecorationSource, MarkDecoration } from '$lib/decorations/types';
import type { DecorationEngine } from '$lib/decorations/decoration-state.svelte';
import type { EditorInstance } from '$lib/editor-props';

beforeAll(() => {
	// BlockHost measures its own height; jsdom has no layout, so the observer is a stub.
	(globalThis as any).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	// A find-bar query reveals its active match; jsdom ships no scrollIntoView, and the
	// rejection would surface as an unhandled error that muddies every assertion here.
	Element.prototype.scrollIntoView = () => {};
});

type MountedEditor = EditorInstance & {
	__test: { getDecorationEngine(): DecorationEngine; getContentVersion(): number };
};

let mounted: MountedEditor | null = null;
let target: HTMLElement | null = null;

afterEach(() => {
	if (mounted) void unmount(mounted);
	target?.remove();
	mounted = null;
	target = null;
});

function mountEditor(source: string): { editor: MountedEditor; props: { source: string } } {
	target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ source });
	mounted = mount(Editor, { target, props }) as MountedEditor;
	flushSync();
	return { editor: mounted, props };
}

/** Apply the prop write, then let the swap effect's deferred decoration run land: the
 *  bump is scheduled a tick past the reset so no source reads a half-applied tree. */
async function settleSwap(): Promise<void> {
	flushSync();
	await tick();
	await tick();
}

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
		await settleSwap();

		expect(seen.at(-1)).toEqual({ blocks: 1, epoch: 1 });
	});

	// The buckets, not the counter: `runSlot`'s idle-source guard skips reassignment on
	// an empty→empty run, so an epoch-only assertion would pass over a stale bucket.
	it('replaces the published buckets, leaving nothing at a path the new document lacks', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n\nthree\n');
		editor.getDecorations().addSource(tailSource([]));
		const engine = editor.__test.getDecorationEngine();
		expect(engine.marksForPath([2])).toHaveLength(1);

		props.source = 'only\n';
		await settleSwap();

		expect(engine.marksForPath([0])).toHaveLength(1);
		expect(engine.marksForPath([2])).toHaveLength(0);
	});

	// The perf contract: a document swap with nothing registered does no decoration work.
	it('skips the run entirely when no source is registered', async () => {
		const { editor, props } = mountEditor('one\n\ntwo\n');
		props.source = 'only\n';
		await settleSwap();
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
		await settleSwap();
		const afterSwap = editor.__test.getContentVersion();
		expect(afterSwap).not.toBe(before);

		// The `source !== lastSource` guard: an identical prop write replaces no bytes.
		props.source = 'only\n';
		await settleSwap();
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
		await settleSwap();

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
		await settleSwap();

		expect(search.matches.map((m) => m.path)).toEqual([[1], [2]]);
	});
});

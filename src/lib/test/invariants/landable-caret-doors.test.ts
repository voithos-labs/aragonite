// @vitest-environment jsdom
//
// Miss-analysis: G1.33 fired from inside one door's own body, so no test ever drove a caret door
// the platform did not mint — a plugin's own `parkCaret`, or the render-primary reveal — and the
// whole bypass class sat outside the suite.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Component } from 'svelte';
import type { BlockComponent, BlockComponentExports, BlockComponentProps } from '$lib/plugin';
import {
	declarePluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockOpener,
	simpleLeafClosure,
	OPENER_PRIORITIES,
	type EditorPlugin
} from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { mountEditor, type MountedEditor } from '../blocks/editor-mount';
import { takeDevWarns } from '../support/warn-gate';
import RogueCaretDoorBlock from './fixtures/RogueCaretDoorBlock.svelte';
import MarkerSourcePlainBlock from './fixtures/MarkerSourcePlainBlock.svelte';
import MarkerSourceRevealBlock from './fixtures/MarkerSourceRevealBlock.svelte';

const ROGUE_MARKER = '@@rogue';
const PLAIN_MARKER = '@@plain';
const REVEAL_MARKER = '@@reveal';

/** A plugin whose kind is one whole line spelled `marker`, the smallest kind an opener can mint. */
function markerLinePlugin<P extends Partial<BlockComponentProps> & Record<string, unknown>>(
	kind: string,
	marker: string,
	component: Component<P, BlockComponentExports>
): EditorPlugin {
	return definePluginBlock({
		name: kind,
		kind,
		component,
		register: () => {
			const declared = declarePluginKind(kind);
			registerBlockKind(declared, {
				mergeRole: 'not-mergeable',
				editable: true,
				supportsInline: false,
				closure: simpleLeafClosure({
					focus: { mode: 'implemented', via: 'the fixture owns the caret door under test' },
					searchPaint: { mode: 'inherit-default' },
					undo: { mode: 'inherit-default' },
					simOracle: { mode: 'inherit-default' }
				})
			});
			registerBlockOpener(declared, {
				priority: OPENER_PRIORITIES.thematicBreak - 5,
				interruptsParagraph: false,
				tryOpen: (ctx) =>
					ctx.lines[ctx.index].text === marker
						? {
								node: {
									kind: declared,
									raw: ctx.lines[ctx.index].raw,
									leadingTrivia: ctx.leadingTrivia
								},
								consumed: 1
							}
						: null
			});
		}
	});
}

function blockComponentAt(mounted: MountedEditor, path: number[]): BlockComponent {
	const probe = mounted.instance as unknown as {
		__test: { getBlockComponent(path: number[]): BlockComponent | null };
	};
	const block = probe.__test.getBlockComponent(path);
	if (!block) throw new Error(`no block component at ${JSON.stringify(path)}`);
	return block;
}

let mounted: MountedEditor | null = null;

async function mountWith(
	marker: string,
	plugin: EditorPlugin,
	presentationMode: 'live' | 'source'
) {
	mounted = mountEditor({
		source: `${marker}\n`,
		plugins: [plugin],
		presentationMode,
		// Windowing off, so the block under assertion stays mounted in a zero-height jsdom.
		scrollMode: 'host'
	});
	await mounted.settle();
	return mounted;
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

describe('G1.33 fires from the focus seam', () => {
	it('fires when a plugin caret door of its own seats a caret in a marker-only surface', async () => {
		const editor = await mountWith(
			ROGUE_MARKER,
			markerLinePlugin('rogue-caret-door', ROGUE_MARKER, RogueCaretDoorBlock),
			'live'
		);
		expect(takeDevWarns(), 'a block nothing has focused traps no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});

	// Source paints every byte, so the same door over the same chrome traps nothing.
	it('stands down for the same door in source mode', async () => {
		const editor = await mountWith(
			ROGUE_MARKER,
			markerLinePlugin('rogue-caret-door', ROGUE_MARKER, RogueCaretDoorBlock),
			'source'
		);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns()).toEqual([]);
	});

	// The platform's own door no longer fires the guard from its body; it inherits it here.
	it('fires when the shared editable factory parks into a marker-only surface', async () => {
		const editor = await mountWith(
			PLAIN_MARKER,
			markerLinePlugin('marker-source-plain', PLAIN_MARKER, MarkerSourcePlainBlock),
			'live'
		);
		expect(takeDevWarns(), 'a block nothing has focused traps no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});

	it('fires when the render-primary reveal seats a caret in a marker-only source', async () => {
		const editor = await mountWith(
			REVEAL_MARKER,
			markerLinePlugin('marker-source-reveal', REVEAL_MARKER, MarkerSourceRevealBlock),
			'live'
		);
		expect(takeDevWarns(), 'the folded rendered view seats no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});
});

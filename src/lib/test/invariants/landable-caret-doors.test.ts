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
import InertSurfaceBlock from './fixtures/InertSurfaceBlock.svelte';

const ROGUE_MARKER = '@@rogue';
const PLAIN_MARKER = '@@plain';
const REVEAL_MARKER = '@@reveal';
const INERT_MARKER = '@@inert';

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
				gapEdges: 'none',
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

/** The plugin whose own `parkCaret` is the bypass under test, in both modes. */
const ROGUE_CARET_DOOR = markerLinePlugin('rogue-caret-door', ROGUE_MARKER, RogueCaretDoorBlock);

function blockComponentAt(mounted: MountedEditor, path: number[]): BlockComponent {
	const probe = mounted.instance as unknown as {
		__test: { getBlockComponent(path: number[]): BlockComponent | null };
	};
	const block = probe.__test.getBlockComponent(path);
	if (!block) throw new Error(`no block component at ${JSON.stringify(path)}`);
	return block;
}

/** A stand-down claim is only evidence once the door has actually taken focus. */
function expectFocusLandedIn(selector: string): void {
	expect(
		document.activeElement?.closest(selector),
		`no focus landed in ${selector}`
	).not.toBeNull();
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
		const editor = await mountWith(ROGUE_MARKER, ROGUE_CARET_DOOR, 'live');
		expect(takeDevWarns(), 'a block nothing has focused traps no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});

	// Source paints every byte, so the same door over the same chrome traps nothing.
	it('stands down for the same door in source mode', async () => {
		const editor = await mountWith(ROGUE_MARKER, ROGUE_CARET_DOOR, 'source');

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expectFocusLandedIn('.rogue-door-block');
		expect(takeDevWarns()).toEqual([]);
	});

	// The stand-down arm for a surface that takes no keystroke. No built-in reaches it — a built-in
	// is `contenteditable="false"` only in reading, which the mode gate already excludes — so
	// nothing else tells the next reader the arm is load-bearing for plugin surfaces.
	it('stands down for an inert surface, over chrome the rogue door fires on', async () => {
		const editor = await mountWith(
			INERT_MARKER,
			markerLinePlugin('inert-caret-door', INERT_MARKER, InertSurfaceBlock),
			'live'
		);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expectFocusLandedIn('.inert-door-block');
		expect(takeDevWarns()).toEqual([]);
	});

	// The platform's own door inherits the guard here rather than carrying it in its body.
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

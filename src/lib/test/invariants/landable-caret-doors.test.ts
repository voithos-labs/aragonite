// @vitest-environment jsdom
//
// Miss-analysis: G1.33 fired from inside one function's own body, so no test ever drove a caret
// placement the platform did not write itself (a plugin's own `parkCaret`, or the render-primary
// scroll into view), and the whole bypass class sat outside the suite.
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
import { mountEditor, type MountedEditor } from '$lib/test/harness/mount-editor.svelte';
import { takeDevWarns } from '../support/warn-gate';
import RogueCaretDoorBlock from './fixtures/RogueCaretDoorBlock.svelte';
import MarkerSourcePlainBlock from './fixtures/MarkerSourcePlainBlock.svelte';
import MarkerSourceRevealBlock from './fixtures/MarkerSourceRevealBlock.svelte';
import InertSurfaceBlock from './fixtures/InertSurfaceBlock.svelte';

const ROGUE_MARKER = '@@rogue';
const PLAIN_MARKER = '@@plain';
const REVEAL_MARKER = '@@reveal';
const INERT_MARKER = '@@inert';

/** A plugin whose kind is one whole line spelled `marker`, the smallest kind an opener can make. */
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

/** The plugin whose own `parkCaret` is the bypass under test, in both editable modes. */
const ROGUE_CARET_DOOR = markerLinePlugin('rogue-caret-door', ROGUE_MARKER, RogueCaretDoorBlock);

function blockComponentAt(mounted: MountedEditor, path: number[]): BlockComponent {
	const probe = mounted.instance as unknown as {
		__test: { getBlockComponent(path: number[]): BlockComponent | null };
	};
	const block = probe.__test.getBlockComponent(path);
	if (!block) throw new Error(`no block component at ${JSON.stringify(path)}`);
	return block;
}

/** A claim that nothing happened is only evidence once focus has actually moved. */
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

describe('G1.33 fires from the focus boundary', () => {
	it('fires when a plugin caret entry point of its own puts a caret in a marker-only surface', async () => {
		const editor = await mountWith(ROGUE_MARKER, ROGUE_CARET_DOOR, 'live');
		expect(takeDevWarns(), 'a block nothing has focused traps no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});

	// Source mode paints every byte, so the same call over the same markers traps nothing.
	it('does nothing for the same entry point in source mode', async () => {
		const editor = await mountWith(ROGUE_MARKER, ROGUE_CARET_DOOR, 'source');

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expectFocusLandedIn('.rogue-door-block');
		expect(takeDevWarns()).toEqual([]);
	});

	// The branch for a block that takes no keystroke. No built-in reaches it, because a built-in is
	// `contenteditable="false"` only in reading mode, which the mode check already excludes, so
	// nothing else tells the next reader this branch matters for plugin blocks.
	it('does nothing for an inert surface, over chrome the rogue entry point fires on', async () => {
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

	// The platform's own caret call gets the check from here rather than carrying it in its body.
	it('fires when the shared editable factory puts the caret into a marker-only surface', async () => {
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

	it('fires when the render-primary reveal puts a caret in a marker-only source', async () => {
		const editor = await mountWith(
			REVEAL_MARKER,
			markerLinePlugin('marker-source-reveal', REVEAL_MARKER, MarkerSourceRevealBlock),
			'live'
		);
		expect(takeDevWarns(), 'the folded rendered view holds no caret').toEqual([]);

		blockComponentAt(editor, [0]).parkCaret?.(0);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landable-caret']);
	});
});

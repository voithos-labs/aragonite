// @vitest-environment jsdom

// Mounting a plugin component through the published surface ONLY. The in-repo mount harness
// is not packaged, so an author's recipe has to stand alone; this file IS that recipe.
//
// Miss-analysis: every mounted-block suite reached the internal harness, so nothing held the
// published surface to mounting one — the jsdom stubs and the scroll mode were maintainer
// knowledge with no test standing on them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { Editor, type EditorInstance } from '$lib';
import {
	declarePluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockOpener,
	simpleLeafClosure,
	OPENER_PRIORITIES,
	type EditorPlugin,
	type ParsedLine
} from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import PlainLeafBlock from './fixtures/PlainLeafBlock.svelte';

const KIND = 'jsdom-mount-leaf';
const MARKER = '@@';
const SOURCE = `intro\n\n${MARKER}\nfirst\nsecond\n${MARKER}\n\noutro\n`;

/** A closed `@@ … @@` block — multi-line on purpose, so the leaf's newlines are observable. */
function markerBlockExtent(lines: readonly ParsedLine[], index: number): number {
	if (lines[index].text !== MARKER) return 0;
	for (let i = index + 1; i < lines.length; i++) {
		if (lines[i].text === MARKER) return i - index + 1;
	}
	return 0;
}

function markerLeafPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'jsdommountplugin',
		kind: KIND,
		component: PlainLeafBlock,
		register: () => {
			const kind = declarePluginKind(KIND);
			registerBlockKind(kind, {
				mergeRole: 'not-mergeable',
				editable: true,
				supportsInline: false,
				closure: simpleLeafClosure({
					focus: { mode: 'implemented', via: 'createEditableLeaf plain mode' },
					searchPaint: { mode: 'inherit-default' },
					undo: { mode: 'implemented', via: 'plain mode — every keystroke commits' },
					simOracle: { mode: 'inherit-default' }
				})
			});
			registerBlockOpener(kind, {
				priority: OPENER_PRIORITIES.thematicBreak - 5,
				interruptsParagraph: false,
				tryOpen: (ctx) => {
					const consumed = markerBlockExtent(ctx.lines, ctx.index);
					if (consumed === 0) return null;
					const raw = ctx.lines
						.slice(ctx.index, ctx.index + consumed)
						.map((l) => l.raw)
						.join('');
					return { node: { kind, raw, leadingTrivia: ctx.leadingTrivia }, consumed };
				}
			});
		}
	});
}

let instance: EditorInstance | null = null;
let target: HTMLElement | null = null;

function mountEditor(plugins: EditorPlugin[]): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(Editor, {
		target,
		// A short fixture, so it stays under the windowing watermark and every block mounts.
		props: { source: SOURCE, plugins, scrollMode: 'host' as const }
	}) as EditorInstance;
	flushSync();
	return target;
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(() => {
	if (instance) void unmount(instance);
	target?.remove();
	instance = null;
	target = null;
});

describe('mounting a plugin block through the published surface', () => {
	it('renders the plugin leaf as an editable surface holding its raw bytes', () => {
		const root = mountEditor([markerLeafPlugin()]);

		const leaf = root.querySelector<HTMLElement>('.plain-leaf-block');
		expect(leaf, 'the plugin component mounted').not.toBeNull();
		expect(leaf?.getAttribute('contenteditable')).toBe('true');
		// The single-text-node contract: the surface's text IS the block's raw, newlines included.
		expect(leaf?.textContent).toBe(`${MARKER}\nfirst\nsecond\n${MARKER}`);
		expect(leaf?.childNodes).toHaveLength(1);
	});

	it('round-trips the seeded document byte-for-byte with the plugin installed', () => {
		mountEditor([markerLeafPlugin()]);
		expect(instance?.getSource()).toBe(SOURCE);
	});

	// Non-vacuity: without the plugin the same bytes mount as built-in blocks, so the
	// assertions above are reading the plugin's own component, not a coincidence.
	it('mounts no plugin surface when the plugin is absent', () => {
		const root = mountEditor([]);
		expect(root.querySelector('.plain-leaf-block')).toBeNull();
		expect(instance?.getSource()).toBe(SOURCE);
	});
});

describe('installEditorDomStubsForTests', () => {
	it('never clobbers an API the environment already provides', () => {
		class RealResizeObserver {
			observe(): void {}
			unobserve(): void {}
			disconnect(): void {}
		}
		const globals = globalThis as { ResizeObserver?: unknown };
		const previous = globals.ResizeObserver;
		globals.ResizeObserver = RealResizeObserver;
		try {
			installEditorDomStubsForTests();
			expect(globals.ResizeObserver).toBe(RealResizeObserver);
		} finally {
			globals.ResizeObserver = previous;
		}
	});

	it('installs the observer jsdom lacks when it is absent', () => {
		const globals = globalThis as { ResizeObserver?: unknown };
		const previous = globals.ResizeObserver;
		delete globals.ResizeObserver;
		try {
			installEditorDomStubsForTests();
			expect(typeof globals.ResizeObserver).toBe('function');
		} finally {
			globals.ResizeObserver = previous;
		}
	});
});

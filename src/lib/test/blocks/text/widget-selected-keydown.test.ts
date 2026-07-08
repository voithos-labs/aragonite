// @vitest-environment jsdom
//
// The selected-widget keydown path routes custom keys (image Shift+Arrow resize)
// through the widget kind's editing policy — no `kind === 'image'` branch. These
// exercise the full dispatch: real parse → flattenInlineWidgets → policy lookup →
// handler, including the nested `[![alt][ref]][repo]` reference image.
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { augmentInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '$lib/components/image/image-widget-editing';
import type { CstNode } from '$lib/core/nodes';
import type { LinkReferenceResolverRef } from '$lib/editor-keys';

beforeAll(() => {
	// Mirrors the mount-time wire-up (built-in-blocks.ts): the core image kind
	// carries no onSelectedKey until the editor layer attaches its resize handler.
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
});

interface Commit {
	index: number;
	raw: string;
	before: number;
	after: number;
}

function harness(source: string, sourceStart: number, linkRef?: LinkReferenceResolverRef) {
	const node: CstNode = parse(source).children[0];
	const commits: Commit[] = [];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: sourceStart });

	const trap = () => {
		throw new Error('unexpected dep access on the selected-widget resize path');
	};
	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => null,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => 800,
		cursor: new Proxy({}, { get: trap }),
		widgetSelection,
		blockEdit: {
			updateBlockContent: (index: number, raw: string, before: number, after: number) => {
				commits.push({ index, raw, before, after });
			}
		},
		focusActions: new Proxy({}, { get: trap }),
		getSnapTarget: trap,
		setSnapTarget: trap,
		setPendingCursor: trap,
		get linkRef() {
			return linkRef;
		}
	} as unknown as WidgetInteractionDeps;

	return { interaction: createWidgetInteraction(deps), commits };
}

function shiftRight(): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });
}

describe('handleSelectedWidgetKeydown — Shift+Arrow through the editing policy', () => {
	it('resizes a selected image via its onSelectedKey handler', async () => {
		const { interaction, commits } = harness('![a](x)\n', 0);
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ index: 0, before: 0, after: 11 });
		expect(commits[0].raw).toContain('![a|420](x)');
	});

	it('resizes a reference image nested in a link, keeping the reference form', async () => {
		const resolve = (label: string) => {
			const norm = label.toLowerCase();
			if (norm === 'shot') return { url: 'cat.png' };
			if (norm === 'repo') return { url: 'https://repo' };
			return undefined;
		};
		const { interaction, commits } = harness('[![cat][shot]][repo]\n', 1, {
			current: resolve,
			signature: 'shot|repo'
		});
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ index: 0, before: 1, after: 17 });
		expect(commits[0].raw).toContain('![cat|420][shot]');
		expect(commits[0].raw).not.toContain('cat.png');
	});

	it('consumes Shift+Arrow on a non-resizable widget without committing an edit', async () => {
		// A <br> is a live widget whose policy declares no onSelectedKey: the key is
		// swallowed (never leaks into step-out) but nothing resizes.
		const { interaction, commits } = harness('a<br>b\n', 1);
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toEqual([]);
	});
});

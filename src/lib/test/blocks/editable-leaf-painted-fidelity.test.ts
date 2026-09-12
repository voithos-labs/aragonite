// @vitest-environment jsdom
//
// Miss-analysis: the painter's fidelity was a header promise ("text-preserving by construction")
// with no guard behind it; the code block asserted its own render, so no test ever asked what a
// plugin's painter hands the leaf.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RevealLeafBlock from './fixtures/RevealLeafBlock.svelte';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import type { CstNode, Document } from '$lib/core/nodes';
import { editorMountContext } from '../harness/mount-context';
import { takeDevWarns } from '../support/warn-gate';
import { installLayoutStubs } from './editor-mount';

const KIND = 'painted-leaf';
const SOURCE = '@@ one\ntwo';

/** Drains the microtask queue the reveal runs on. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

/** Two spans and a bare newline: the shape a highlighter hands back, every byte kept. */
function faithfulPainter(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const [i, line] of text.split('\n').entries()) {
		if (i > 0) frag.appendChild(document.createTextNode('\n'));
		const span = document.createElement('span');
		span.className = 'painted-line';
		span.textContent = line;
		frag.appendChild(span);
	}
	return frag;
}

function lossyPainter(text: string): DocumentFragment {
	return faithfulPainter(text.slice(1));
}

function mountLeaf(paint: (text: string) => DocumentFragment) {
	const kind = declarePluginKind(KIND);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});
	const node: CstNode = { kind, leadingTrivia: '', raw: `${SOURCE}\n` } as CstNode;
	const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(RevealLeafBlock, {
		target,
		props: { node, index: 0, myPath: [0], paint },
		context: editorMountContext({ doc: { doc: () => doc } })
	});
	flushSync();
	return {
		instance,
		revealAtEnd: async () => {
			instance.parkCaret(SOURCE.length);
			await flush();
			const el = target.querySelector<HTMLElement>('.reveal-leaf-source');
			expect(el, 'the reveal mounted no source element').not.toBeNull();
			return el!;
		}
	};
}

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

describe('a painted source at the leaf’s one paint seam', () => {
	it('keeps textContent equal to the source across the painter’s spans', async () => {
		mounted = mountLeaf(faithfulPainter);
		const el = await mounted.revealAtEnd();

		expect(el.textContent).toBe(SOURCE);
		expect(el.querySelectorAll('.painted-line')).toHaveLength(2);
		expect(takeDevWarns()).toEqual([]);
	});

	it('fires G1.28 on a painter that drops a byte, whatever plugin supplied it', async () => {
		mounted = mountLeaf(lossyPainter);
		await mounted.revealAtEnd();

		const fires = takeDevWarns().map((record) => record.tag);
		expect(fires).toContain('invariant:rendered-text-fidelity');
	});
});

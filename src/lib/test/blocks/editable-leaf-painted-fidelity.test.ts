// @vitest-environment jsdom
//
// Miss-analysis: the painter's fidelity was a header promise ("text-preserving by construction")
// with no guard behind it; the code block asserted its own render, so no test ever asked what a
// plugin's painter hands the leaf.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unmount } from 'svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { takeDevWarns } from '../support/warn-gate';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';

const KIND = 'painted-leaf';
const SOURCE = '@@ one\ntwo';

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
	const kind = registerRevealLeafKind(KIND);
	return mountRevealLeaf(leafDocument(kind, `${SOURCE}\n`), { props: { paint } });
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

describe('a painted source at the leaf’s one paint site', () => {
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

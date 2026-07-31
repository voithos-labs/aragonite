// @vitest-environment jsdom
//
// Every hop from the document facet to the widget's props is optional-typed, and the
// fallback for a missing version is CORRECT — just O(widgets × leaves). So a broken hop
// leaves every numbering test green, and only counting walks tells the two apart.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import {
	enablePerfInstruments,
	disablePerfInstruments,
	resetPerfInstruments,
	perfSnapshot
} from '$lib/perf/instruments';
import { editorMountContext } from '../../harness/mount-context';

const LEAVES = 30;

// Two references in the mounted block, and a document deep enough that one walk
// and two are unmistakable: each walk inline-parses every prose leaf.
function documentWithReferences(): ReturnType<typeof parse> {
	const body = ['Body has [^a] and [^b] here.'];
	for (let i = 1; i < LEAVES; i++) body.push(`Filler paragraph ${i}.`);
	return parse(body.join('\n\n') + '\n');
}

function mountReferences(contentVersion: () => number) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = documentWithReferences();
	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ doc: { doc: () => doc, contentVersion } })
	});
	flushSync();
	return { instance, refs: [...target.querySelectorAll('.footnote-ref')] };
}

let mounted: ReturnType<typeof mountReferences>;

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([footnotesPlugin()]);
	resetPerfInstruments();
	enablePerfInstruments();
});

afterEach(async () => {
	disablePerfInstruments();
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('footnote reference widgets read the editor content version', () => {
	it('renders both numbers off the version the document facet supplies', () => {
		const contentVersion = vi.fn(() => 1);
		mounted = mountReferences(contentVersion);

		expect(mounted.refs.map((el) => el.textContent)).toEqual(['1', '2']);
		// Both widgets must reach the version; one falling back to its own walk is
		// the shape that renders correctly and costs double.
		expect(contentVersion.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('inline-parses the document once for both widgets, not once each', () => {
		// A distinct version per test so this can never hit the previous case's entry.
		mounted = mountReferences(() => 4242);
		expect(mounted.refs.map((el) => el.textContent)).toEqual(['1', '2']);

		// The WALK COUNT, not the raw compute total: the block's own render adds a small
		// constant, so rounding puts the verdict midway between one walk and two rather
		// than one incidental compute away from being unable to fail.
		const walks = Math.round(perfSnapshot().inlineComputeCount / LEAVES);
		expect(walks).toBe(1);
	});
});

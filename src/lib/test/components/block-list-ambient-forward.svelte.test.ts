// @vitest-environment jsdom
//
// Miss-analysis (#43): the ambient marker was only ever asserted where it PAINTS, so the forward
// was pinned by its happy shape alone — a first child that ignores the prop dropped it silently,
// and no case read what the list handed over rather than what the child drew.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockList from '$lib/components/BlockList.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode, Document } from '$lib/core/nodes';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { registerBlockComponent, defineBlockComponent } from '$lib/schema/block-component-registry';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import { testClosure } from '$lib/test/support/closure';
import { editorMountContext } from '../harness/mount-context';
import { installBlockHostLayoutStubs } from './mount-host';
import RecordingBlock from './fixtures/RecordingBlock.svelte';

const MARKER = '[^a]: ';

beforeAll(installBlockHostLayoutStubs);

/** A recording kind that answers the platform's "does this surface paint inline content?" one
 *  way or the other — the only thing the forward reads. */
function recordingKind(name: string, supportsInline: boolean) {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline,
		closure: testClosure
	});
	registerBlockComponent(
		kind,
		defineBlockComponent(RecordingBlock, () => ({}))
	);
	return kind;
}

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
	if (dispose) await dispose();
	dispose = null;
	__resetSchemaRegistriesForTests();
});

/** Mount a one-child list carrying `MARKER` for its first child, and report what arrived. */
function deliveredPrefix(supportsInline: boolean): string {
	const node: CstNode = {
		kind: recordingKind('ambient-probe', supportsInline),
		leadingTrivia: '',
		raw: 'x\n'
	};
	const doc = { children: [node], suffix: '' } as unknown as Document;
	const refs: (BlockComponent | undefined)[] = [];
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BlockList, {
		target,
		props: {
			children: doc.children,
			blockIds: ['block-0'],
			slots: refSlotsOver(refs),
			parentPath: [0],
			ambientPrefixForFirst: MARKER
		},
		context: editorMountContext({ doc: { doc: () => doc } })
	});
	flushSync();
	dispose = async () => {
		await unmount(instance);
		target.remove();
	};
	return (refs[0] as unknown as { deliveredProps(): { ambientPrefix: string } }).deliveredProps()
		.ambientPrefix;
}

describe('a container marker reaches only a first child that paints one', () => {
	it('hands it to a surface that paints inline content', () => {
		expect(deliveredPrefix(true)).toBe(MARKER);
	});

	it('withholds it from one that does not, rather than handing it over to be dropped', () => {
		expect(deliveredPrefix(false)).toBe('');
	});
});

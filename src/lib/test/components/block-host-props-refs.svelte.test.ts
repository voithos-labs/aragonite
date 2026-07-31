// @vitest-environment jsdom
//
// The two things BlockHost hands its child that nothing else can: the props it reads
// from editor context, and the ref slot every container's focus, reveal and clipboard
// walk resolves through. Only the registered-component branch answers behaviorally —
// the fallback accepts `document` for parity and never binds it, so both branches stay
// pinned by the source scan in invariants/lint/block-host-prop-thread.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '$lib/core/parser';
import type { BlockComponent } from '$lib/block-component';
import type { EditorServices } from '$lib/editor-keys';
import { registerBlockComponent, defineBlockComponent } from '$lib/schema/block-component-registry';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import RecordingBlock from './fixtures/RecordingBlock.svelte';
import {
	declareComponentlessKind,
	installBlockHostLayoutStubs,
	mountBlockHost
} from './mount-host';
import type { HostProps, MountedHost } from './mount-host';

beforeAll(installBlockHostLayoutStubs);

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	__resetSchemaRegistriesForTests();
});

type Recorder = BlockComponent & {
	deliveredProps(): { document: unknown; rects: unknown; myPath: number[]; ambientPrefix: string };
};

/** A document whose block at `index` renders through the recording fixture. */
function recordingDoc(source: string, index = 0) {
	const doc = parse(source);
	const kind = declareComponentlessKind('host-recording');
	registerBlockComponent(
		kind,
		defineBlockComponent(RecordingBlock, () => ({ badge: 'from-extra-props' }))
	);
	doc.children[index].kind = kind;
	return doc;
}

describe('BlockHost delivers its context-read props to the component it dispatched', () => {
	it('hands over the live document and the instance rect surface', () => {
		const doc = recordingDoc('recorded\n');
		const rects = { blockRect: () => null } as unknown as EditorServices['rects'];

		mounted = mountBlockHost(doc, { index: 0, parentPath: [3] }, { services: { rects } });
		const delivered = (mounted.refs[0] as Recorder).deliveredProps();

		expect(delivered.document).toBe(doc);
		expect(delivered.rects).toBe(rects);
	});

	it('hands over the composed path and the ambient prefix it was mounted with', () => {
		mounted = mountBlockHost(recordingDoc('recorded\n'), {
			index: 0,
			parentPath: [3],
			ambientPrefix: '> '
		});
		const delivered = (mounted.refs[0] as Recorder).deliveredProps();

		expect(delivered.myPath).toEqual([3, 0]);
		expect(delivered.ambientPrefix).toBe('> ');
	});
});

describe('BlockHost publishes its component into the caller’s ref slot', () => {
	// The slot index is the claim, not the document shape, so the node is named
	// explicitly and the index moved around it. A `$state` props object stays live.
	function mountAtSlot(props: HostProps): MountedHost {
		const doc = recordingDoc('recorded\n');
		props.node = doc.children[0];
		return mountBlockHost(doc, props);
	}

	it('fills the slot at its own index with the mounted component', () => {
		mounted = mountAtSlot({ index: 2 });

		expect(mounted.refs[2]?.editable).toBe(true);
		expect(mounted.refs[0]).toBeUndefined();
	});

	it('moves the ref to the new slot when its index shifts, clearing the old one', () => {
		// A reorder or a sibling splice re-indexes a live host; the slot must follow
		// or the container's focus walk resolves the wrong block (publish-ref.svelte).
		const props: HostProps = $state({ index: 1 });
		mounted = mountAtSlot(props);
		expect(mounted.refs[1]).toBeDefined();

		props.index = 4;
		flushSync();

		expect(mounted.refs[4]).toBeDefined();
		expect(mounted.refs[1]).toBeUndefined();
	});

	it('withdraws the ref on unmount, so a windowed-out block leaves no stale slot', async () => {
		mounted = mountAtSlot({ index: 2 });
		const { refs } = mounted;

		await mounted.dispose();
		mounted = null;

		expect(refs[2]).toBeUndefined();
	});
});

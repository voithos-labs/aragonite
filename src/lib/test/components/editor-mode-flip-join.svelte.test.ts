// @vitest-environment jsdom
// Miss-analysis: every unit join test built its reading with a fixed mode, so an editor reading
// that kept the mode it mounted with passed them all and only failed in e2e.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import type { PresentationMode } from '$lib/presentation-mode';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const SPLIT = 'Some **bo**\n\n**ld** text\n';

async function joinAfterFlip(from: PresentationMode, to: PresentationMode): Promise<string> {
	mounted = mountEditor({ source: SPLIT, presentationMode: from });
	await mounted.settle();
	mounted.props.presentationMode = to;
	await mounted.settle();
	await pressKeyAt(mounted, [1], 0, { key: 'Backspace' });
	await mounted.settle();
	return mounted.source();
}

describe('a join reads the mode in force at the keypress, not the one the editor mounted with', () => {
	it('mounted in source, flipped to live: the join drops the delimiters it leaves unpaired', async () => {
		expect(await joinAfterFlip('source', 'live')).toBe('Some **bold** text\n');
	});

	it('mounted in live, flipped to source: the join keeps every byte', async () => {
		expect(await joinAfterFlip('live', 'source')).toBe('Some **bo****ld** text\n');
	});

	it.each(['source', 'live'] as const)(
		'mounted in %s, flipped to reading: the join writes nothing',
		async (from) => {
			expect(await joinAfterFlip(from, 'reading')).toBe(SPLIT);
		}
	);
});

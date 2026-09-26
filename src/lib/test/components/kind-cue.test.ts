// Miss-analysis: nothing reported a typed kind change at all, so no test could tell a keystroke
// that changed the block from one that kept it, or a hidden-marker mode from source mode.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { Document } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import { createKindCue } from '$lib/components/kind-cue.svelte';
import { shownKind } from '$lib/core/parsers/heading';

function cueOver(source: string, mode: PresentationMode) {
	let doc: Document = parse(source);
	const announced: string[] = [];
	const cue = createKindCue({
		getDoc: () => doc,
		getPresentationMode: () => mode,
		announce: (label) => announced.push(label)
	});
	/** A typed write that leaves the document reading `next`. */
	const typeTo = (next: string) => {
		const before = shownKind(doc.children[0]);
		doc = parse(next);
		return cue.afterTypedWrite(Promise.resolve(), [0], before);
	};
	const undoTo = (previous: string) => void (doc = parse(previous));
	return { cue, announced, typeTo, undoTo };
}

describe('the kind cue', () => {
	it('names the new kind when a typed write changes it in live mode', async () => {
		const { cue, announced, typeTo } = cueOver('title\n', 'live');
		await typeTo('# title\n');
		expect(cue.labelAt([0])).toBe('Heading level 1');
		expect(announced).toEqual(['Heading level 1']);
	});

	it.each(['preview-block', 'preview-inline'] as const)('cues in %s too', async (mode) => {
		const { cue, typeTo } = cueOver('notes\n', mode);
		await typeTo('\tnotes\n');
		expect(cue.labelAt([0])).toBe('Code block');
	});

	it('reports nothing for a write that keeps the kind', async () => {
		const { cue, announced, typeTo } = cueOver('title\n', 'live');
		await typeTo('titles\n');
		expect(cue.labelAt([0])).toBeUndefined();
		expect(announced).toEqual([]);
	});

	it('reports nothing in source mode, where the markers explain the change', async () => {
		const { cue, announced, typeTo } = cueOver('title\n', 'source');
		await typeTo('# title\n');
		expect(cue.labelAt([0])).toBeUndefined();
		expect(announced).toEqual([]);
	});

	it('reports nothing for a bare `#`, which still paints as the paragraph', async () => {
		const { cue, typeTo } = cueOver('\n', 'live');
		await typeTo('#\n');
		expect(cue.labelAt([0])).toBeUndefined();
	});

	it('forgets the label once its fade ends', async () => {
		const { cue, typeTo } = cueOver('title\n', 'live');
		await typeTo('- title\n');
		expect(cue.labelAt([0])).toBe('List');
		cue.dismiss([0]);
		expect(cue.labelAt([0])).toBeUndefined();
	});

	// Miss-analysis: the label was keyed by path alone and every case left the cued block in place,
	// so none saw an undo inside the fade put a paragraph where the heading was.
	it('drops the label once an undo inside the fade takes the kind back', async () => {
		const { cue, typeTo, undoTo } = cueOver('title\n', 'live');
		await typeTo('# title\n');
		undoTo('title\n');
		expect(cue.labelAt([0])).toBeUndefined();
	});
});

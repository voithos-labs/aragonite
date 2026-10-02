import { describe, it, expect } from 'vitest';
import { openPick } from '$lib/inline-menu/pick-context';
import { createDraftRegistry } from '$lib/components/draft-registry';
import { createDocumentStamps } from '$lib/editor-actions/commit/document-stamp';
import type { EditorContext } from '$lib/schema/plugin-install';

// A pick's commit gets the owner's context with refusing writers: everything else must still read
// live through it, since a spread would freeze `document` and the other getters.
function setup() {
	const stamps = createDocumentStamps();
	const drafts = createDraftRegistry(stamps);
	const calls: string[] = [];
	let generation = 0;
	let doc = { children: ['a'] };
	const owner = {
		options: { max: 3 },
		get document() {
			return doc;
		},
		get documentGeneration() {
			return generation;
		},
		insertMarkdown: async (md: string) => (calls.push(md), true),
		runCommand: (id: string) => (calls.push(id), true)
	} as unknown as EditorContext;
	const pick = openPick(owner, drafts);
	const swap = () => {
		stamps.retire();
		drafts.closeAll('document-swap');
		generation++;
		doc = { children: ['b'] };
	};
	return { pick, calls, swap };
}

describe('a pick commit’s context', () => {
	it('writes through the owner while the pick’s document is in place', async () => {
		const { pick, calls } = setup();
		expect(await pick.editor.insertMarkdown('x')).toBe(true);
		expect(pick.editor.runCommand('heading.cycle')).toBe(true);
		expect(calls).toEqual(['x', 'heading.cycle']);
		expect(pick.editor.signal.aborted).toBe(false);
	});

	it('refuses both writes after a swap, and aborts its signal', async () => {
		const { pick, calls, swap } = setup();
		swap();
		expect(await pick.editor.insertMarkdown('x')).toBe(false);
		expect(pick.editor.runCommand('heading.cycle')).toBe(false);
		expect(calls).toEqual([]);
		expect(pick.editor.signal.aborted).toBe(true);
	});

	it('reads the owner’s members live, the document and its generation included', () => {
		const { pick, swap } = setup();
		expect(pick.editor.options).toEqual({ max: 3 });
		swap();
		expect(pick.editor.document).toEqual({ children: ['b'] });
		expect(pick.editor.documentGeneration).toBe(1);
	});
});

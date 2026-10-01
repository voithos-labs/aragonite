import { describe, it, expect } from 'vitest';
import { createDraftRegistry, type DraftCloseCause } from '$lib/components/draft-registry';

function openOn(registry: ReturnType<typeof createDraftRegistry>, bytes: { now: string }) {
	const closes: DraftCloseCause[] = [];
	const draft = registry.open({
		seed: bytes.now,
		current: () => bytes.now,
		close: (cause) => closes.push(cause)
	});
	return { draft, closes };
}

describe('a draft held outside the document', () => {
	it('may write while its document and its bytes are the ones it opened on', () => {
		const { draft } = openOn(createDraftRegistry(), { now: 'x' });
		expect(draft.canWrite()).toBe(true);
	});

	it('is dropped by a write to its bytes', () => {
		const bytes = { now: 'x' };
		const { draft } = openOn(createDraftRegistry(), bytes);
		bytes.now = 'y';
		expect(draft.canWrite()).toBe(false);
	});

	// The torn-down block's blur reads the handle after the swap, ended or not.
	it('is dropped by a swap, and stays dropped once its owner ends it', () => {
		const registry = createDraftRegistry();
		const { draft, closes } = openOn(registry, { now: 'x' });
		registry.closeAll('document-swap');
		draft.end();
		expect(closes).toEqual(['document-swap']);
		expect(draft.canWrite()).toBe(false);
	});

	it('a swap leaves the next document’s drafts and life alive', () => {
		const registry = createDraftRegistry();
		const before = registry.documentLife();
		registry.closeAll('document-swap');
		expect(before.live).toBe(false);
		expect(registry.documentLife().live).toBe(true);
		expect(openOn(registry, { now: 'x' }).draft.canWrite()).toBe(true);
	});

	it('a mode change closes a draft still open, once, and keeps it writable', () => {
		const registry = createDraftRegistry();
		const { draft, closes } = openOn(registry, { now: 'x' });
		registry.closeAll('mode-change');
		registry.closeAll('mode-change');
		expect(closes).toEqual(['mode-change']);
		expect(draft.canWrite()).toBe(true);
	});

	it('an ended draft is never closed', () => {
		const registry = createDraftRegistry();
		const { draft, closes } = openOn(registry, { now: 'x' });
		draft.end();
		registry.closeAll('mode-change');
		registry.closeAll('document-swap');
		expect(closes).toEqual([]);
	});
});

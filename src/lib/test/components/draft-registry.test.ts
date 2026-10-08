import { describe, it, expect } from 'vitest';
import { createDraftRegistry } from '#lib/components/draft-registry.js';
import type { DraftCloseCause } from '#lib/schema/drafts.js';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';

function setup() {
	const stamps = createDocumentStamps();
	const registry = createDraftRegistry(stamps);
	/** What the document swap does: the outgoing document dies, then its drafts close. */
	const swap = () => {
		stamps.retire();
		registry.closeAll('document-swap');
	};
	return { registry, swap };
}

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
		const { draft } = openOn(setup().registry, { now: 'x' });
		expect(draft.canWrite()).toBe(true);
	});

	it('is dropped by a write to its bytes', () => {
		const bytes = { now: 'x' };
		const { draft } = openOn(setup().registry, bytes);
		bytes.now = 'y';
		expect(draft.canWrite()).toBe(false);
	});

	// The torn-down block's blur reads the handle after the swap, ended or not.
	it('is dropped by a swap, and stays dropped once its owner ends it', () => {
		const { registry, swap } = setup();
		const { draft, closes } = openOn(registry, { now: 'x' });
		swap();
		draft.end();
		expect(closes).toEqual(['document-swap']);
		expect(draft.canWrite()).toBe(false);
	});

	it('a draft opened after a swap belongs to the next document', () => {
		const { registry, swap } = setup();
		swap();
		expect(openOn(registry, { now: 'x' }).draft.canWrite()).toBe(true);
	});

	it('a mode change closes a draft still open, once, and keeps it writable', () => {
		const { registry } = setup();
		const { draft, closes } = openOn(registry, { now: 'x' });
		registry.closeAll('mode-change');
		registry.closeAll('mode-change');
		expect(closes).toEqual(['mode-change']);
		expect(draft.canWrite()).toBe(true);
	});

	it('an ended draft is never closed', () => {
		const { registry, swap } = setup();
		const { draft, closes } = openOn(registry, { now: 'x' });
		draft.end();
		registry.closeAll('mode-change');
		swap();
		expect(closes).toEqual([]);
	});
});

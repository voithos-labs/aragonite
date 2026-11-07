// The editor's drafts as the editor closes them: a swap drops every one, a mode change gives an
// open one its chance to save, and a write recorded over a draft's block makes it stale.
import { describe, it, expect } from 'vitest';
import { idleDraftRegistry } from '../../harness/drafts';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';
import { captureChange, changeAfter } from '#lib/editor-actions/commit/change-record.js';
import { parse } from '#lib/core/parser.js';
import type { Document } from '#lib/core/nodes.js';
import type { DraftCloseCause } from '#lib/schema/drafts.js';

function setup(source = 'one\n\ntwo\n') {
	const stamps = createDocumentStamps();
	const live = { doc: parse(source) as Document };
	const registry = idleDraftRegistry(stamps, () => live.doc);
	/** What the document swap does: the outgoing document dies, then its drafts close. */
	const swap = () => {
		stamps.retire();
		registry.closeAll('document-swap');
	};
	/** A write elsewhere, recorded as the commit frame records it. */
	const write = (next: string) => {
		const capture = captureChange(live.doc, null);
		live.doc = parse(next);
		registry.record(changeAfter(live.doc, capture, null));
	};
	return { registry, swap, write };
}

function openOn(registry: ReturnType<typeof setup>['registry'], path?: number[]) {
	const closes: DraftCloseCause[] = [];
	const draft = registry.open({ close: (cause) => closes.push(cause) }, path);
	return { draft, closes };
}

describe('a draft held outside the document', () => {
	it('stays fresh while its document is the one it opened on', () => {
		const { draft } = openOn(setup().registry, [1]);
		expect(draft.stale).toBe(false);
	});

	it('goes stale at a write to its block, and not at one elsewhere', () => {
		const s = setup();
		const { draft } = openOn(s.registry, [1]);
		s.write('one!\n\ntwo\n');
		expect(draft.stale).toBe(false);
		s.write('one!\n\ntwo?\n');
		expect(draft.stale).toBe(true);
	});

	// The torn-down block's blur reads the handle after the swap, ended or not.
	it('is dropped by a swap, and stays dropped once its owner ends it', () => {
		const { registry, swap } = setup();
		const { draft, closes } = openOn(registry);
		swap();
		draft.end();
		expect(closes).toEqual(['document-swap']);
		expect(draft.stale).toBe(true);
	});

	it('a draft opened after a swap belongs to the next document', () => {
		const { registry, swap } = setup();
		swap();
		expect(openOn(registry).draft.stale).toBe(false);
	});

	it('a mode change closes a draft still open, once, and keeps it fresh', () => {
		const { registry } = setup();
		const { draft, closes } = openOn(registry, [0]);
		registry.closeAll('mode-change');
		registry.closeAll('mode-change');
		expect(closes).toEqual(['mode-change']);
		expect(draft.stale).toBe(false);
	});

	it('an ended draft is never closed, and keeps what it heard before it ended', () => {
		const s = setup();
		const { draft, closes } = openOn(s.registry, [0]);
		s.write('zero\n\ntwo\n');
		draft.end();
		s.registry.closeAll('mode-change');
		expect(closes).toEqual([]);
		expect(draft.stale).toBe(true);
	});

	it('makes writes record only while one is open', () => {
		const { registry } = setup();
		expect(registry.watching()).toBe(false);
		const { draft } = openOn(registry, [0]);
		expect(registry.watching()).toBe(true);
		draft.end();
		expect(registry.watching()).toBe(false);
	});
});

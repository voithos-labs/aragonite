import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acceptedBlockAttrs, RESERVED_BLOCK_ATTRS } from '$lib/decorations/reserved-attrs';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';

// The block host is an ancestor of every walk container, so a decoration spelling one of the
// editor's own `data-` names answers an ancestor lookup the walk and the CSS families read.
// Miss-analysis: the attrs write had no validation at all and no test named the hazard — the
// class was invisible to both the CSS-parity probe and the runtime guards it exists to protect.

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	configureEditorEnv({ isDev: true, isTest: false }); // let devWarn reach console
});

afterEach(() => {
	warnSpy.mockRestore();
	resetEditorEnv();
});

describe('acceptedBlockAttrs', () => {
	it('drops a reserved attribute and warns, naming it', () => {
		const accepted = acceptedBlockAttrs({ 'data-content-empty': '' }, [2]);

		expect(accepted).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("'data-content-empty' is reserved"),
			{ path: [2] }
		);
	});

	it("lets a decoration author's own attribute through untouched", () => {
		expect(acceptedBlockAttrs({ 'data-review-state': 'stale' }, [0])).toEqual([
			['data-review-state', 'stale']
		]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	// The skip must not swallow what follows it: a rejected name and an accepted one arrive in
	// one attrs object, and the applied-key bookkeeping downstream reads only the survivors.
	it('keeps the benign attributes of an object that also carries a reserved one', () => {
		expect(acceptedBlockAttrs({ 'data-focused': '', title: 'note' }, [1])).toEqual([
			['title', 'note']
		]);
	});

	it('is empty for a decoration carrying no attrs', () => {
		expect(acceptedBlockAttrs(undefined, [0])).toEqual([]);
	});

	// The names the walk, the CSS families and selection/windowing reach for from an ancestor
	// position. A consumer added without its name here is a hole the warn cannot see.
	it('reserves the ancestor-read vocabulary', () => {
		expect([...RESERVED_BLOCK_ATTRS].sort()).toEqual([
			'data-block-kind',
			'data-block-path',
			'data-content-empty',
			'data-cross-block',
			'data-decoration-island',
			'data-focused',
			'data-gap-caret',
			'data-image-overlay',
			'data-image-widget',
			'data-inline-widget',
			'data-link-card',
			'data-presentation',
			'data-table-row-idx'
		]);
	});
});

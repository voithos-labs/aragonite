import { describe, it, expect } from 'vitest';
import { acceptedBlockAttrs, RESERVED_BLOCK_ATTRS } from '$lib/decorations/reserved-attrs';
import { takeDevWarns } from '../support/warn-gate';

// The block host is an ancestor of every walk container, so a decoration spelling one of the
// editor's own `data-` names answers an ancestor lookup the walk and the CSS families read.
// Miss-analysis: the attrs write had no validation at all and no test named the hazard — the
// class was invisible to both the CSS-parity probe and the runtime guards it exists to protect.

describe('acceptedBlockAttrs', () => {
	it('drops a reserved attribute and warns, naming it', () => {
		const accepted = acceptedBlockAttrs({ 'data-content-empty': '' }, [2]);

		expect(accepted).toEqual([]);
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain("'data-content-empty' is reserved");
		expect(fires[0].details).toEqual({ path: [2] });
	});

	it("lets a decoration author's own attribute through untouched", () => {
		expect(acceptedBlockAttrs({ 'data-review-state': 'stale' }, [0])).toEqual([
			['data-review-state', 'stale']
		]);
		expect(takeDevWarns()).toEqual([]);
	});

	// The skip must not swallow what follows it: a rejected name and an accepted one arrive in
	// one attrs object, and the applied-key bookkeeping downstream reads only the survivors.
	it('keeps the benign attributes of an object that also carries a reserved one', () => {
		expect(acceptedBlockAttrs({ 'data-focused': '', title: 'note' }, [1])).toEqual([
			['title', 'note']
		]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data-focused' is reserved")
		]);
	});

	// `setAttribute` lowercases, so every reserved name is one capital away from landing anyway —
	// and `data-Presentation` lands as the stamp the caret walk and the CSS families both read.
	it('drops a reserved name spelled with capitals', () => {
		expect(acceptedBlockAttrs({ 'data-Presentation': 'garbage' }, [0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data-Presentation' is reserved")
		]);
	});

	// `setAttribute` throws on these, and the write runs inside a decoration effect: the throw takes
	// the mount, where dropping the one attribute costs the decoration nothing else.
	it('drops a name the DOM would refuse', () => {
		expect(acceptedBlockAttrs({ 'data attr': 'x', '2bad': 'y' }, [0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data attr' is not a valid attribute name"),
			expect.stringContaining("'2bad' is not a valid attribute name")
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

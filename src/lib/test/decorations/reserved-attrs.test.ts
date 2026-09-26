import { describe, it, expect } from 'vitest';
import { acceptedBlockAttrs } from '$lib/decorations/reserved-attrs';
import { takeDevWarns } from '../support/warn-gate';

// The block host is an ancestor of every element the offset traversal walks, so a decoration
// using one of the editor's own `data-` names answers an ancestor lookup that traversal and the
// CSS both read. Miss-analysis: writing those attributes was never validated and no test named
// the hazard, so it was invisible both to the CSS comparison and to the checks it protects.

describe('acceptedBlockAttrs', () => {
	it('drops a reserved attribute and warns, naming it', () => {
		const accepted = acceptedBlockAttrs({ 'data-content-empty': '' }, [2]);

		expect(accepted).toEqual([]);
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain("'data-content-empty' is reserved");
		expect(fires[0].details).toEqual({ path: [2] });
	});

	// A block decoration setting the kind cue's label would paint that label for good.
	// Miss-analysis: the set was checked against a copy of itself, so no case named an attribute
	// the editor had started setting since.
	it('drops the attributes the kind cue and a whole-block input set', () => {
		const attrs = { 'data-kind-cue': 'Heading', 'data-whole-block-input': '' };
		expect(acceptedBlockAttrs(attrs, [0])).toEqual([]);
		expect(takeDevWarns()).toHaveLength(2);
	});

	// A name the editor uses only inside a block (a menu row's state) reads nothing on the block's
	// own element, so a decoration may take it.
	it('lets through a name the editor sets only on an inner element', () => {
		expect(acceptedBlockAttrs({ 'data-active': 'yes', 'data-group': 'a' }, [0])).toEqual([
			['data-active', 'yes'],
			['data-group', 'a']
		]);
		expect(takeDevWarns()).toEqual([]);
	});

	it("lets a decoration author's own attribute through untouched", () => {
		expect(acceptedBlockAttrs({ 'data-review-state': 'stale' }, [0])).toEqual([
			['data-review-state', 'stale']
		]);
		expect(takeDevWarns()).toEqual([]);
	});

	// Skipping one must not swallow what comes after it: a rejected name and an accepted one
	// arrive in the same object, and the record of what was applied reads only the survivors.
	it('keeps the benign attributes of an object that also carries a reserved one', () => {
		expect(acceptedBlockAttrs({ 'data-focused': '', title: 'note' }, [1])).toEqual([
			['title', 'note']
		]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data-focused' is reserved")
		]);
	});

	// `setAttribute` lowercases, so every reserved name is one capital letter away from landing
	// anyway, and `data-Presentation` lands as the attribute the caret traversal and the CSS read.
	it('drops a reserved name spelled with capitals', () => {
		expect(acceptedBlockAttrs({ 'data-Presentation': 'garbage' }, [0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data-Presentation' is reserved")
		]);
	});

	// `setAttribute` throws on these, and the write runs inside a decoration effect, so the throw
	// takes down the mount, where dropping the one attribute costs the decoration nothing else.
	it('drops a name the DOM would refuse', () => {
		expect(acceptedBlockAttrs({ 'data attr': 'x', '2bad': 'y' }, [0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'data attr' is not a valid attribute name"),
			expect.stringContaining("'2bad' is not a valid attribute name")
		]);
	});

	// Every decorated element renders these, and cleanup would strip them. Miss-analysis: only
	// each element's extras were refused and no row passed `class`, so `class` got through.
	it.each(['class', 'contenteditable', 'role', 'style', 'tabindex'])(
		"drops '%s', an attribute every decorated element renders itself",
		(name) => {
			expect(acceptedBlockAttrs({ [name]: 'x', title: 'note' }, [1])).toEqual([['title', 'note']]);
			expect(takeDevWarns().map((w) => w.message)).toEqual([
				expect.stringContaining(`'${name}' is reserved`)
			]);
		}
	);

	it('drops an element-rendered attribute in any spelling', () => {
		expect(acceptedBlockAttrs({ ContentEditable: 'false' }, [0, 1, 0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("'ContentEditable' is reserved")
		]);
	});

	it("points a refused class at the decoration's class field", () => {
		acceptedBlockAttrs({ class: 'x' }, [1]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			expect.stringContaining("decoration's class field")
		]);
	});

	it('is empty for a decoration carrying no attrs', () => {
		expect(acceptedBlockAttrs(undefined, [0])).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
// Importing the authoring barrel must NOT activate `:::` — activation is the
// explicit `activateDirectives()` call, never an import side effect. This file
// imports the barrel and deliberately never calls it; vitest's per-file module
// isolation guarantees no sibling case activated the grammar here.
import * as pluginBarrel from '$lib/plugin';

describe('directive activation is call-based, not an import side effect', () => {
	it('exposes activateDirectives as a barrel function', () => {
		expect(pluginBarrel.activateDirectives).toBeTypeOf('function');
	});

	it('leaves ::: unclaimed until activateDirectives() is called', () => {
		// No activateDirectives() call anywhere above — a container fence must parse as
		// plain GFM (a paragraph), proving the barrel import alone claimed nothing.
		const doc = parse(':::x\ny\n:::\n');
		expect(doc.children[0].kind).not.toBe('directiveContainer');
		expect(doc.children[0].kind).toBe('paragraph');
	});
});

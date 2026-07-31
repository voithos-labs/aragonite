import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
// The barrel is imported and deliberately never called: activation must be the explicit
// `activateDirectives()`, never an import side effect. Vitest isolates modules per file.
import * as pluginBarrel from '$lib/plugin';

describe('directive activation is call-based, not an import side effect', () => {
	it('exposes activateDirectives as a barrel function', () => {
		expect(pluginBarrel.activateDirectives).toBeTypeOf('function');
	});

	it('leaves ::: unclaimed until activateDirectives() is called', () => {
		const doc = parse(':::x\ny\n:::\n');
		expect(doc.children[0].kind).not.toBe('directiveContainer');
		expect(doc.children[0].kind).toBe('paragraph');
	});
});

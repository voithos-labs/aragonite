import { describe, it, expect, beforeEach } from 'vitest';
import { updateNodeContent, splitNode } from '../../tree-operations/node-ops';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode } from '../../core/nodes';

function registerChromeKind() {
	const chrome = declarePluginKind('spec-chrome');
	registerBlockKind(chrome, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	return chrome;
}

describe('updateNodeContent — contextDependentKind stickiness', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('keeps a context-dependent kind through a content edit (no downgrade)', () => {
		const chrome = registerChromeKind();
		const parent = { children: [{ kind: chrome, leadingTrivia: '', raw: 'Title\n' }] as CstNode[] };

		const change = updateNodeContent(parent as never, 0, 'TitleX\n');

		expect(parent.children[0].kind).toBe(chrome); // sticky — not reparsed to paragraph
		expect(parent.children[0].raw).toBe('TitleX\n');
		expect(change).toEqual({ op: 'noop' });
	});

	it('still reparses an ordinary kind (paragraph→heading on marker insert)', () => {
		const parent = {
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'hi\n' }] as CstNode[]
		};
		updateNodeContent(parent as never, 0, '# hi\n');
		expect(parent.children[0].kind).toBe('heading'); // ordinary reparse unaffected
	});
});

describe('splitNode — contextDependentKind is unsplittable', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('no-ops on a context-dependent kind without mutating children', () => {
		const chrome = registerChromeKind();
		const parent = { children: [{ kind: chrome, leadingTrivia: '', raw: 'Title\n' }] as CstNode[] };

		const change = splitNode(parent as never, 0, 3);

		expect(change).toEqual({ op: 'noop' });
		expect(parent.children).toHaveLength(1);
		expect(parent.children[0].kind).toBe(chrome);
		expect(parent.children[0].raw).toBe('Title\n');
	});

	it('still splits an ordinary paragraph into two reparsed halves', () => {
		const parent = {
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'hello world\n' }] as CstNode[]
		};
		const change = splitNode(parent as never, 0, 5);
		expect(change).toMatchObject({ op: 'replace', newCount: 2 });
		expect(parent.children).toHaveLength(2);
	});
});

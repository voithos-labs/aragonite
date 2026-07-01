import { describe, it, expect, beforeEach } from 'vitest';
import { updateNodeContent } from '../../tree-operations/node-ops';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import type { CstNode } from '../../core/nodes';

describe('updateNodeContent — contextDependentKind stickiness', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('keeps a context-dependent kind through a content edit (no downgrade)', () => {
		const chrome = declarePluginKind('spec-chrome');
		registerBlockKind(chrome, {
			mergeRole: 'not-mergeable',
			editable: true,
			isContainer: false,
			supportsInline: false,
			contextDependentKind: true
		});
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

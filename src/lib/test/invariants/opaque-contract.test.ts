import { describe, it, expect, beforeEach } from 'vitest';
import { checkStaleRaw } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import type { CstNode } from '../../core/nodes';

describe('containerContract opaque — checkStaleRaw exemption', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('exempts an opaque container whose raw is not a strip of its children', () => {
		const kind = declarePluginKind('spec-opaque');
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			isContainer: true,
			supportsInline: false,
			containerContract: 'opaque',
			rebuildRaw: () => {}
		});
		// raw deliberately diverges from serialize(children) — the opaque contract.
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::title::\nbody\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		};
		expect(checkStaleRaw(node)).toBeNull();
	});
});

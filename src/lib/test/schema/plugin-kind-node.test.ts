import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind, getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isBuiltinBlockKind, type CstNode, type Document } from '../../core/nodes';
import { serialize } from '../../core/serializer';

describe('plugin-kind node is a first-class CST citizen', () => {
	it('declares a non-builtin kind, registers a descriptor, and round-trips through serialize', () => {
		const kind = declarePluginKind('nodeCitizenCallout');
		expect(isBuiltinBlockKind(kind)).toBe(false);
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: true,
			isContainer: false,
			supportsInline: false
		});
		expect(getBlockKindDescriptor(kind).editable).toBe(true);

		// CstNode.kind must accept a PluginBlockKind. This assignment is the
		// typecheck guard — it fails to compile if the field narrows back to BlockKind.
		const node: CstNode = { kind, leadingTrivia: '', raw: '::: callout body' };
		const doc: Document = { kind: 'document', prefix: '', children: [node], suffix: '' };
		expect(serialize(doc)).toBe('::: callout body');
	});
});

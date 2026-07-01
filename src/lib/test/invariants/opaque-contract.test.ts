import { describe, it, expect, beforeEach } from 'vitest';
import { checkStaleRaw, checkOpaqueRawFixpoint } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { concatChildren } from '../../core/serializer';
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

describe('checkOpaqueRawFixpoint (opaque containers)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	function registerOpaque(name: string) {
		const kind = declarePluginKind(name);
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			isContainer: true,
			supportsInline: false,
			containerContract: 'opaque',
			rebuildRaw: (node) => {
				node.raw = `::x\n${concatChildren(node.children ?? [])}::\n`;
			}
		});
		return kind;
	}

	it('passes when raw is the rebuild fixpoint', () => {
		const kind = registerOpaque('spec-fix-ok');
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::x\nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		};
		expect(checkOpaqueRawFixpoint(node)).toBeNull();
	});

	it('fires when children mutated without a rebuild (stale opaque raw)', () => {
		const kind = registerOpaque('spec-fix-stale');
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::x\nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'CHANGED\n' }]
		};
		expect(checkOpaqueRawFixpoint(node)?.code).toBe('opaque-raw-fixpoint');
	});

	it('is pure — the probe rebuild never mutates the committed node', () => {
		const kind = registerOpaque('spec-fix-pure');
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::x\nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'CHANGED\n' }]
		};
		checkOpaqueRawFixpoint(node);
		expect(node.raw).toBe('::x\nbody\n::\n');
	});
});

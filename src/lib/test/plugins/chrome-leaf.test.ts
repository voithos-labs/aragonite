import { describe, it, expect, beforeEach } from 'vitest';
import { declarePluginKind } from '../../schema/plugin-kind';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isBlockComponentRegistered } from '../../schema/block-component-registry';
import { registerChromeLeaf } from '../../editor-actions/plugin-chrome-leaf';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';

describe('registerChromeLeaf', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('registers a context-dependent, not-mergeable editable chrome leaf + its component', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind, {
			blockClass: 'spec-chrome-leaf',
			keymap: [{ chord: 'Enter', command: 'block.split' }]
		});

		const d = getBlockKindDescriptor(kind);
		expect(d.editable).toBe(true);
		expect(d.isContainer).toBe(false);
		expect(d.supportsInline).toBe(false);
		expect(d.contextDependentKind).toBe(true);
		expect(d.mergeRole).toBe('not-mergeable');
		expect(d.keymap?.[0]).toEqual({ chord: 'Enter', command: 'block.split' });
		expect(isBlockComponentRegistered(kind)).toBe(true);
	});
});

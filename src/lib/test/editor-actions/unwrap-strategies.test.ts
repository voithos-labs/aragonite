import { describe, expect, it } from 'vitest';
import {
	firstChildUnwrapStrategies,
	middleChildUnwrapStrategies
} from '$lib/editor-actions/unwrap-strategies';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';

describe('unwrapRole declarations resolve to registered strategies', () => {
	it('every declared role names an implemented strategy', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const role = tryGetBlockKindDescriptor(kind)?.unwrapRole;
			if (!role) continue;
			expect(firstChildUnwrapStrategies[role.firstChildBackspace]).toBeTypeOf('function');
			if (role.middleChildBackspace !== 'default-merge') {
				expect(middleChildUnwrapStrategies[role.middleChildBackspace]).toBeTypeOf('function');
			}
		}
	});

	it('blockquote and list declare the legacy wiring; listItem stays undeclared (delegates up)', () => {
		expect(tryGetBlockKindDescriptor('blockquote')?.unwrapRole).toEqual({
			firstChildBackspace: 'lift-first-child',
			middleChildBackspace: 'default-merge',
			quoteShaped: true
		});
		expect(tryGetBlockKindDescriptor('list')?.unwrapRole).toEqual({
			firstChildBackspace: 'list-item-cascade',
			middleChildBackspace: 'list-item-cascade'
		});
		expect(tryGetBlockKindDescriptor('listItem')?.unwrapRole).toBeUndefined();
	});
});

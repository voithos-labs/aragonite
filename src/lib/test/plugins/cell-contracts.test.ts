import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { anchorsOf } from '../../../../scripts/docs/check-codebase-map.mjs';
import {
	CONTAINER_CELL_CONTRACTS,
	INLINE_CELL_CONTRACTS,
	KIND_CELL_CONTRACTS
} from '#lib/testing/cell-contracts.js';

// A failing cell's message sends its author to a section of the published testing guide, so a
// renamed heading there would strand every failure that points at it.
const TESTING_GUIDE = 'docs/guide/plugin-testing.md';

describe('every conformance cell names a contract the testing guide explains', () => {
	const anchors = anchorsOf(readFileSync(TESTING_GUIDE, 'utf8'));
	const tables = {
		kind: KIND_CELL_CONTRACTS,
		container: CONTAINER_CELL_CONTRACTS,
		inline: INLINE_CELL_CONTRACTS
	};

	it.each(Object.entries(tables))('the %s kit points at headings that exist', (_kit, table) => {
		const dangling = Object.entries(table)
			.filter(([, contract]) => !anchors.has(contract.anchor))
			.map(([cell, contract]) => `${cell} -> #${contract.anchor}`);
		expect(dangling, `anchors missing from ${TESTING_GUIDE}`).toEqual([]);
	});

	it('reads a real heading set rather than an empty one', () => {
		expect(anchors).toContain('the-kind-checkup-runkindconformance');
	});
});

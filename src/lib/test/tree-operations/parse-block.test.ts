// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseFirstBlock } from '$lib/editor/tree-operations/parse-block';

describe('parseFirstBlock', () => {
	it('returns first block of parsed input', () => {
		const node = parseFirstBlock('# Heading\n');
		expect(node.kind).toBe('heading');
	});

	it('falls back to paragraph when input is empty', () => {
		const node = parseFirstBlock('');
		expect(node.kind).toBe('paragraph');
	});
});

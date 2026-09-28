// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseFirstBlock } from '$lib/tree-operations/parse-block';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { plainFragmentReader } from '$lib/tree-operations/list/task-paragraph';

describe('parseFirstBlock', () => {
	it('returns first block of parsed input', () => {
		const node = parseFirstBlock('# Heading\n', plainFragmentReader(defaultGrammarView));
		expect(node.kind).toBe('heading');
	});

	it('falls back to paragraph when input is empty', () => {
		const node = parseFirstBlock('', plainFragmentReader(defaultGrammarView));
		expect(node.kind).toBe('paragraph');
	});
});

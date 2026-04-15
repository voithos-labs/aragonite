import { describe, it, expect } from 'vitest';
import { serialize } from '../../core/serializer';

describe('serialize', () => {
	it('serializes an empty document', () => {
		const doc = { kind: 'document' as const, prefix: '', children: [], suffix: '' };
		expect(serialize(doc)).toBe('');
	});

	it('serializes a document with prefix and suffix', () => {
		const doc = {
			kind: 'document' as const,
			prefix: '\n\n',
			children: [
				{ kind: 'heading' as const, leadingTrivia: '', raw: '# Title\n', metadata: { level: 1 } }
			],
			suffix: '\n'
		};
		expect(serialize(doc)).toBe('\n\n# Title\n\n');
	});

	it('serializes multiple blocks with leading trivia', () => {
		const doc = {
			kind: 'document' as const,
			prefix: '',
			children: [
				{ kind: 'heading' as const, leadingTrivia: '', raw: '# Title\n', metadata: { level: 1 } },
				{ kind: 'paragraph' as const, leadingTrivia: '\n', raw: 'Some text.\n' },
				{
					kind: 'thematicBreak' as const,
					leadingTrivia: '\n',
					raw: '---\n',
					metadata: { marker: '-' }
				}
			],
			suffix: ''
		};
		expect(serialize(doc)).toBe('# Title\n\nSome text.\n\n---\n');
	});
});

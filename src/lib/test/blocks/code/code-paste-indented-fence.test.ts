import { describe, it, expect } from 'vitest';
import { computeCodePaste } from '../../../components/blocks/code/code-paste';

describe('computeCodePaste — indented fence opener (J2)', () => {
	it('bumps an opener indented by 3 spaces and preserves the indent', () => {
		const result = computeCodePaste({
			display: '   ```\n\n   ```',
			selection: { start: 7, end: 7 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('   ````\n```\n   ````');
	});

	it('bumps an opener indented by 1 space', () => {
		const result = computeCodePaste({
			display: ' ```\n\n ```',
			selection: { start: 5, end: 5 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe(' ````\n```\n ````');
	});

	it('bumps an indented unclosed opener and preserves the indent', () => {
		const result = computeCodePaste({
			display: '  ```\nfoo',
			selection: { start: 9, end: 9 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: false
		});
		expect(result.text).toBe('  ````\nfoo```');
	});

	it('supports indented tilde fences', () => {
		const result = computeCodePaste({
			display: '  ~~~\n\n  ~~~',
			selection: { start: 6, end: 6 },
			pasted: '~~~',
			fenceMarker: '~',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('  ~~~~\n~~~\n  ~~~~');
	});
});

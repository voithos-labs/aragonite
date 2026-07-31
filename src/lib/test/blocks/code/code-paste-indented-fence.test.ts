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

	// The paste lands on its own line, which is where a run threatens the fence — a run
	// appended to `foo` is not a closer and leaves the opener alone.
	it('bumps an indented unclosed opener and preserves the indent', () => {
		const result = computeCodePaste({
			display: '  ```\nfoo\n',
			selection: { start: 10, end: 10 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: false
		});
		expect(result.text).toBe('  ````\nfoo\n```');
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

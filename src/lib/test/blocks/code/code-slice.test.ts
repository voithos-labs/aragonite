import { describe, it, expect } from 'vitest';
import { sliceFencedCode } from '$lib/components/blocks/code/code-renderer';
import { fencedCode } from './fenced-code-fixture';

describe('sliceFencedCode', () => {
	it('slices a closed fenced block with info string', () => {
		const node = fencedCode('```python\nprint("hi")\n```\n', 'python');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```python\n');
		expect(result.body).toBe('print("hi")\n');
		expect(result.closerLine).toBe('```\n');
		expect(result.infoString).toBe('python');
	});

	it('slices a closed fenced block with no info string', () => {
		const node = fencedCode('```\nhello\n```\n');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('hello\n');
		expect(result.closerLine).toBe('```\n');
		expect(result.infoString).toBe('');
	});

	it('handles an unclosed fence (body runs to EOF)', () => {
		const node = fencedCode('```js\nconst x = 1\n', 'js', { closed: false });
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```js\n');
		expect(result.body).toBe('const x = 1\n');
		expect(result.closerLine).toBe('');
		expect(result.infoString).toBe('js');
	});

	it('handles an empty body', () => {
		const node = fencedCode('```\n```\n');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('');
		expect(result.closerLine).toBe('```\n');
	});

	it('handles tilde fences', () => {
		const node = fencedCode('~~~yaml\nkey: value\n~~~\n', 'yaml', { fenceMarker: '~' });
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('~~~yaml\n');
		expect(result.body).toBe('key: value\n');
		expect(result.closerLine).toBe('~~~\n');
	});

	it('preserves info string with trailing attributes', () => {
		const node = fencedCode('```js {1-3}\nconst x\n```\n', 'js {1-3}');
		const result = sliceFencedCode(node);
		expect(result.infoString).toBe('js {1-3}');
	});

	it('handles a four-backtick fence', () => {
		const node = fencedCode('````python\ncode with ``` inside\n````\n', 'python', {
			fenceLength: 4
		});
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('````python\n');
		expect(result.body).toBe('code with ``` inside\n');
		expect(result.closerLine).toBe('````\n');
	});

	it('handles a degenerate opener-only raw', () => {
		const node = fencedCode('```\n', '', { closed: false });
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('');
		expect(result.closerLine).toBe('');
	});
});

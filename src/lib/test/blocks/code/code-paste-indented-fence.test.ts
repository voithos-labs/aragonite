// @vitest-environment jsdom
// A paste into a code block whose fence is indented: the fence grows and keeps its indent.
import { afterEach, beforeAll, describe, it, expect } from 'vitest';
import { destroyMountedEditors, installLayoutStubs } from '../../harness/mount-editor.svelte';
import { pasteIntoCode as paste } from './paste-into-code';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('code paste: indented fence opener', () => {
	it('bumps an opener indented by 3 spaces and preserves the indent', async () => {
		const result = await paste({
			display: '   ```\n\n   ```',
			selection: { start: 7, end: 7 },
			pasted: '```'
		});
		expect(result.text).toBe('   ````\n```\n   ````');
	});

	it('bumps an opener indented by 1 space', async () => {
		const result = await paste({
			display: ' ```\n\n ```',
			selection: { start: 5, end: 5 },
			pasted: '```'
		});
		expect(result.text).toBe(' ````\n```\n ````');
	});

	// The paste lands on its own line, which is where a run threatens the fence; a run
	// appended to `foo` is not a closer and leaves the opener alone.
	it('bumps an indented unclosed opener and preserves the indent', async () => {
		const result = await paste({
			display: '  ```\nfoo\n',
			selection: { start: 10, end: 10 },
			pasted: '```'
		});
		expect(result.text).toBe('  ````\nfoo\n```');
	});

	it('supports indented tilde fences', async () => {
		const result = await paste({
			display: '  ~~~\n\n  ~~~',
			selection: { start: 6, end: 6 },
			pasted: '~~~'
		});
		expect(result.text).toBe('  ~~~~\n~~~\n  ~~~~');
	});
});

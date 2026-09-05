// @vitest-environment jsdom
//
// A CRLF document must never gain a lone LF before the user has typed anything (G4.20).
// A blank line is a block of its own, so a blank source arrives carrying its own endings
// and only the truly empty source reaches the caret placeholder.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, type MountedEditor } from './editor-mount';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

function sourceAfterMount(source: string): string {
	mounted = mountEditor({ source });
	return mounted.source();
}

describe('Editor mount leaves a blank source alone', () => {
	it.each([
		['CRLF', '\r\n'],
		['LF', '\n']
	])('a blank %s source mounts unchanged — its blank line is already a block', (_label, src) => {
		expect(sourceAfterMount(src)).toBe(src);
	});

	it('an empty source gains the LF caret placeholder', () => {
		expect(sourceAfterMount('')).toBe('\n');
	});
});

// @vitest-environment jsdom
//
// The generic `:::name` container's marker is the opener line itself, so it is sliced out of
// `raw`. Rebuilding it from metadata (colon count plus name) drops everything else the line
// can hold: attributes and trailing spaces round-trip through the CST, and they belong in the
// marker shown directly above the body they label.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeAll(installDirectiveStubs);

let mounted: MountedDirective | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('the directive container marker is the opener line verbatim', () => {
	it.each([
		[':::note\nbody\n:::\n', ':::note'],
		['::::note\nbody\n::::\n', '::::note'],
		[':::note {#id}\nbody\n:::\n', ':::note {#id}'],
		[':::note   \nbody\n:::\n', ':::note   ']
	])('%j renders %j', (source, expected) => {
		mounted = mountDirective(source);

		expect(mounted.target.querySelector('.directive-marker')?.textContent).toBe(expected);
	});

	it('a CRLF opener drops only its line ending', () => {
		mounted = mountDirective(':::note\r\nbody\r\n:::\r\n');

		expect(mounted.target.querySelector('.directive-marker')?.textContent).toBe(':::note');
	});
});

// @vitest-environment jsdom
//
// The generic `:::name` container's chrome marker is the opener line itself, so it
// is sliced from `raw`. Rebuilding it from the block's metadata — colon count plus
// name — silently drops everything else the line can hold: directive attributes
// and trailing spaces both round-trip through the CST but vanished from the cue
// rendered directly above the body they label.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => expectDevWarns(['block-host']));

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

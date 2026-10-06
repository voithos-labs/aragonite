// G1.71: the check passes a command run in the kind its key was claimed by and fails any other.
import { describe, it, expect } from 'vitest';
import { checkCommandLanding } from '$lib/invariants/command-key-landing';

describe('G1.71 a command key over a range runs where its keymap claimed it', () => {
	it('passes the claimed kind', () => {
		expect(checkCommandLanding('paragraph', 'paragraph')).toBeNull();
	});

	it('fails a command that ran in another kind', () => {
		expect(checkCommandLanding('paragraph', 'heading')?.code).toBe('command-key-landing');
	});
});

import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { applyPasteTransforms } from '$lib/tree-operations/paste/paste-transforms';
import { admonitionsPlugin } from '$lib/plugins/admonitions';

// Native rendering makes the alert paste transform opt-in. By default a pasted
// GitHub alert keeps its bytes (it renders as a native `githubAlert`); a host that
// prefers directive source re-enables the rewrite with `convertAlertsOnPaste`.

const ALERT = '> [!TIP]\n> Handy.\n';

describe('github alert — paste transform is opt-in', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
	});

	it('leaves pasted alert bytes untouched by default', () => {
		installPlugins([admonitionsPlugin()]);
		expect(applyPasteTransforms(ALERT)).toBe(ALERT);
	});

	it('rewrites pasted alerts to :::name source when convertAlertsOnPaste is set', () => {
		installPlugins([admonitionsPlugin({ convertAlertsOnPaste: true })]);
		expect(applyPasteTransforms(ALERT)).toBe(':::tip\nHandy.\n:::\n');
	});
});

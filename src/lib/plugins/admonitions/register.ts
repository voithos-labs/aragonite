/**
 * The admonitions plugin: two block kinds from one setup. The `:::name` directive
 * admonition (`:::note` … `:::caution`, all resolving to one `admonition` kind) and
 * the native `githubAlert` (`> [!NOTE]` blockquotes), sharing one render component.
 * A multi-kind plugin, so it wires `definePlugin` directly rather than the
 * single-kind `definePluginBlock` sugar.
 */

import { definePlugin, type EditorPlugin } from '$lib/plugin';
import { registerAdmonitions, type AdmonitionsOptions } from './admonition-kind';

export function admonitionsPlugin(options?: AdmonitionsOptions): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup: () => registerAdmonitions(options)
	});
}

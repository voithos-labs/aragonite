// The plugin name pattern and the qualified names built on it. It sits in its own file with no
// imports: `plugin-kind` already imports `plugin-install`, so keeping the pattern there would close
// a cycle.
const PLUGIN_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

export function isValidPluginName(name: string): boolean {
	return PLUGIN_NAME_PATTERN.test(name);
}

/** A block or inline name a plugin defines, qualified by the plugin's own: `callouts/callout`. */
export function qualifiedName(pluginName: string, localName: string): string {
	if (!isValidPluginName(localName)) {
		throw new Error(
			`plugin '${pluginName}': invalid name "${localName}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
	return `${pluginName}/${localName}`;
}

// The frozen plugin name pattern, shared by `plugin-kind.ts` and `plugin-install.ts`. It sits in
// its own file with no imports: `plugin-kind` already imports `plugin-install`, so keeping the
// pattern there would close a cycle.
const PLUGIN_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

export function isValidPluginName(name: string): boolean {
	return PLUGIN_NAME_PATTERN.test(name);
}

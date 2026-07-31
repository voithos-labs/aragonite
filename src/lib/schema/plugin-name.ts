// The frozen plugin naming family, shared by plugin-kind.ts and plugin-install.ts. A
// dependency-free leaf: plugin-kind already imports plugin-install, so hosting the pattern
// there would close a cycle.
const PLUGIN_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

export function isValidPluginName(name: string): boolean {
	return PLUGIN_NAME_PATTERN.test(name);
}

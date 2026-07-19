// The frozen plugin naming family, shared by `declarePluginKind`/`declarePluginInlineKind`
// (plugin-kind.ts) and `definePlugin` (plugin-install.ts). A dependency-free leaf:
// plugin-kind already imports plugin-install for attribution, so the pattern living in
// plugin-kind would force an import cycle — this leaf keeps the dependency one-way.
const PLUGIN_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

export function isValidPluginName(name: string): boolean {
	return PLUGIN_NAME_PATTERN.test(name);
}

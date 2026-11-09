// Reads a plugin package's exports as `setup` plugin factories or plugin values, and finds a value
// another copy of the core defined: every copy marks what it defines under one shared key.

const UNIT = Symbol.for('@voithos-labs/aragonite:plugin-unit');
const DEFINED_BY = Symbol.for('@voithos-labs/aragonite:defined-by');

/** @param {unknown} value */
export function isPluginValue(value) {
	return typeof value === 'function' && UNIT in value;
}

/**
 * Every plugin value the module exports, whatever its name, and every `*Plugin` factory; a factory
 * that returns a plugin value counts as that value.
 * @param {Record<string, unknown>} module
 * @returns {{ setups: [string, unknown][], values: [string, object][] }}
 */
export function pluginExports(module) {
	/** @type {[string, unknown][]} */
	const setups = [];
	/** @type {[string, object][]} */
	const values = [];
	for (const [name, value] of Object.entries(module)) {
		if (isPluginValue(value)) values.push([name, /** @type {object} */ (value)]);
		else if (/Plugin$/.test(name) && typeof value === 'function') {
			const made = value();
			if (isPluginValue(made)) values.push([name, made]);
			else setups.push([name, made]);
		}
	}
	return { setups, values };
}

/**
 * The names of the values `probe`'s copy of the core didn't define.
 * @param {[string, object][]} values
 * @param {object} probe a plugin value the core in hand defined
 * @returns {string[]}
 */
export function fromAnotherCopy(values, probe) {
	const mark = /** @type {Record<symbol, unknown>} */ (probe)[DEFINED_BY];
	return values
		.filter(([, value]) => /** @type {Record<symbol, unknown>} */ (value)[DEFINED_BY] !== mark)
		.map(([name]) => name);
}

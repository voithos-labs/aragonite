// Reads a plugin package's `*Plugin` exports as `setup` plugin factories or plugin values, and finds a
// value another copy of the core defined: every copy marks what it defines under one shared key.

const UNIT = Symbol.for('@voithos-labs/aragonite:plugin-unit');
const DEFINED_BY = Symbol.for('@voithos-labs/aragonite:defined-by');

/**
 * @param {Record<string, unknown>} module
 * @returns {{ factories: [string, () => unknown][], values: [string, object][] }}
 */
export function pluginExports(module) {
	/** @type {[string, () => unknown][]} */
	const factories = [];
	/** @type {[string, object][]} */
	const values = [];
	for (const [name, value] of Object.entries(module)) {
		if (!/Plugin$/.test(name) || typeof value !== 'function') continue;
		if (UNIT in value) values.push([name, value]);
		else factories.push([name, /** @type {() => unknown} */ (value)]);
	}
	return { factories, values };
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

// `@types/node` is not installed (see platform.ts's `declare const process`), so the part of
// `node:fs` the recorder uses is declared here rather than adding a type package for two
// functions.
declare module 'node:fs' {
	export function mkdirSync(path: string, options: { recursive: boolean }): void;
	export function writeFileSync(path: string, data: string): void;
}

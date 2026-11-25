import { colonLines, container, definePlugin, type Plugin } from '@voithos-labs/aragonite/plugin';

// Type-level proof the authoring surface resolves from outside the repo; never called, since the
// route's own plugin lives in src/plugins.
export const _probe = (): Plugin =>
	definePlugin({
		name: 'probe',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container({
					name: 'probe',
					label: 'Probe',
					lines: colonLines({ names: ['probe'] }),
					sample: ':::probe\nbody\n:::\n',
					insert: { none: 'a type probe' }
				})
			]
		})
	});

// Type-level proof the mermaid renderer subpath resolves, type-only by necessity: a runtime
// import pulls renderer.ts's `import('mermaid')` into a consumer with no engine (routes/plugins).
export type MermaidRendererProbe =
	typeof import('@voithos-labs/aragonite-mermaid/renderer').mermaidRenderer;

// The seam a third-party plugin's own suite checks against; type-only because the barrel is
// test-process-only. One entry per re-export cluster: each pulls a different declaration file.
export type TestingSurfaceProbe = {
	check: typeof import('@voithos-labs/aragonite/testing').check;
	env: typeof import('@voithos-labs/aragonite/testing').configureEditorEnv;
	headless: typeof import('@voithos-labs/aragonite/testing').headless;
	tabOrder: typeof import('@voithos-labs/aragonite/testing').tabOrder;
};

// The framework apps the suite drives: where each lives, how it serves, the framework version its
// page must report (a prefix), the specs it runs, and whether it gates every PR or only a release.
// `scripts/smoke/adapter-smoke.mjs` builds and runs whatever this lists.
const EVERY_APP = ['page-contract', 'host-fill'];
const REACT = [...EVERY_APP];
const VUE = [...EVERY_APP, 'vue'];
// The example apps also serve the showcase (`showcase.html`) and a page of framework-drawn plugin
// blocks (`?block-views`); the meta-framework apps do not.
const EXAMPLE = ['showcase', 'block-views'];

export const APPS = {
	react: {
		cwd: '../react',
		command: 'npm run preview',
		port: 1489,
		version: '19.',
		specs: [...REACT, ...EXAMPLE],
		perPr: true
	},
	'react-dev': {
		cwd: '../react',
		command: 'npm run dev',
		port: 1490,
		version: '19.',
		specs: [...REACT, ...EXAMPLE],
		perPr: true
	},
	next: {
		cwd: '../next',
		command: 'npm start',
		port: 1491,
		version: '19.',
		specs: [...REACT, 'ssr', 'next'],
		perPr: false
	},
	react18: {
		cwd: '../react',
		command: 'npm run preview:react18',
		port: 1492,
		version: '18.',
		specs: [...REACT, ...EXAMPLE],
		perPr: false
	},
	vue: {
		cwd: '../vue',
		command: 'npm run preview',
		port: 1494,
		version: '3.',
		specs: [...VUE, ...EXAMPLE],
		perPr: true
	},
	'vue-dev': {
		cwd: '../vue',
		command: 'npm run dev',
		port: 1495,
		version: '3.',
		specs: [...VUE, ...EXAMPLE],
		perPr: true
	},
	nuxt: {
		cwd: '../nuxt',
		command: 'npm start',
		port: 1496,
		version: '3.',
		specs: [...EVERY_APP, 'ssr'],
		perPr: false
	},
	vue33: {
		cwd: '../vue',
		command: 'npm run preview:vue33',
		port: 1497,
		version: '3.3.',
		specs: [...VUE, ...EXAMPLE],
		perPr: false
	}
};

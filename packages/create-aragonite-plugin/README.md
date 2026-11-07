# @voithos-labs/create-aragonite-plugin

Starts a plugin for [aragonite](https://github.com/voithos-labs/aragonite):

```bash
npm create @voithos-labs/aragonite-plugin@latest my-plugin
```

Keep the `@latest`, or npm may hand you a copy it cached a few releases ago.

That makes a `my-plugin` folder holding a working plugin (a `%%parrot` line that dances as an ASCII party parrot), its unit and browser tests, a playground page, and CI that runs the same check the plugin gallery runs. The package is named after the folder. It asks no questions and runs nothing else, so `cd` in and take it from there:

```bash
cd my-plugin
npm install
npm run dev
```

The new folder's README walks you the rest of the way, from GitHub to npm to the gallery, and the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md) explains every line of the parrot.

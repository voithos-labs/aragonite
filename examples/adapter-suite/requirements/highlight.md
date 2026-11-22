# Feature: code highlighting inside a framework app

The example apps list the highlight package (`highlight({ renderer: highlightJs() })`), and their
`load-code` button loads a `js` fence and a `rust` fence. The page logs every editor `error` event
to the console, so every scenario fails on one, as on any console error, page error, aragonite dev
warning or Vue warning.

## Happy paths

- The `js` fence paints `const` as a keyword: its grammar loads with the page.
- The `rust` fence paints `fn` as a keyword once its grammar's chunk lands: the app's bundler split
  it out of highlight.js and serves it.

## Miss-analysis

- Nothing in the page contract mounted a fence, so the suite would pass with highlighting dead in
  React and Vue.

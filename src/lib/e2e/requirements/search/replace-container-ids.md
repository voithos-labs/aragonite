# Feature: Replace All keeps nested containers intact

Replace All rewrites whole subtrees at once. When the needle sits inside
nested lists, the rebuilt containers must stay renderable — a past regression
left the refreshed containers unable to key their children, and list items
with more than one child crashed with "block failed to render".

## Happy paths

- Replace All on a word that appears throughout the default demo document's
  nested lists rewrites every occurrence and leaves the document healthy: no
  block fails to render, no errors fire, every nested container still tracks
  its children, and the result round-trips stably.

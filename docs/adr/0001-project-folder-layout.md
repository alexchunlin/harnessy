# Project folder layout and id scheme

A project is any folder on disk, reached through a Vite server plugin rather than the browser's File System Access API, because only Chromium can write to a local folder from page JavaScript and the team runs the dev server anyway. Files split by what people edit together: one file per component and per topology, one file per domain for nets, and every drawn position under `canvas/` so model files never change when someone tidies a diagram. Ids for project entities are generated (`cmp-k3f9qa`) rather than typed slugs (library entries are the exception, see ADR-0002), and a file's name is its id, so renaming a component never moves a file or rewrites references; the cost is that a directory listing tells you nothing without the app. Domains and layers keep typed slugs because they name files under `nets/`. One deterministic serializer (fixed key order, id-sorted arrays, integer millimetres and pixels) keeps git diffs to the user's actual edits.

## Considered options

- Projects committed inside this repo under `projects/`. Rejected: Alex wants to open any folder.
- User-typed slugs as ids. Rejected: collisions and rename pressure; the display name carries meaning instead.
- One file per net, or a single `nets.json`. Rejected: per domain matches how two engineers split work, so merges rarely collide.
- A gitignored `.harnessy/` for UI state. Rejected in favour of localStorage: nothing to gitignore.

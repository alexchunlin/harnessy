# Library ids are slugs, references are folder-qualified

Project entities use generated ids so renames never move files. Library entries do the opposite: a typed slug (`jst-gh-6`, `xt60`, `cat6-utp-24awg`) is the id and the filename. The part is a natural key that does not get renamed, the catalogue is committed in this repo and hand-edited, and a directory listing of it should read as a parts list. Every reference to an entry is spelled `<folder>/<id>` so ids need only be unique within a kind and a single field can point at a wire or a cable. Connectors on a component instance are addressed by the definition's designator (`cmp-k3f9qa/CAN-A`) rather than a generated id, because the designator is what engineers read on the board and what the BOM prints. Instances reference definitions live; a removed designator leaves a dangling reference for the design rule check to list rather than blocking the load.

## Considered options

- Generated ids for library entries. Rejected: no rename pressure, and an unreadable tree hurts hand editing.
- One file per kind holding an array. Rejected: worse merges, and whole-file shadowing would shadow the whole kind.
- Generated `con-` ids on instances with a slot field pointing at the designator. Rejected: two names for one thing.
- Refuse to load a project with a dangling designator. Rejected: nothing is deleted silently; the DRC lists it.

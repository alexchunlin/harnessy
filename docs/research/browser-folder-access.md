# Can a browser app open a folder of JSON files and save back in place?

Research for issue #3, checked 2026-09-18 against MDN browser-compat-data, the WICG spec, caniuse, Mozilla and WebKit standards positions, Chrome developer docs, and the Vite docs.

## Verdict

Only Chromium browsers can open a local directory and write files back in place from page JavaScript. Firefox and Safari have declined to ship the picker and drag-and-drop handle APIs, and their fallbacks are read-only: you can load a folder tree but you cannot save into it without a download dialog or a zip.

Recommendation: serve a small file API from the Vite dev server (a plugin using `configureServer`) and make that the primary path. Every engineer already runs `vite` on localhost, the plugin has Node `fs` access to the checkout, and it works identically in all three browsers. Treat `showDirectoryPicker` as an optional enhancement for Chromium, or skip it to keep one code path.

## 1. showDirectoryPicker and createWritable

`window.showDirectoryPicker`: Chrome 86, Edge (mirrors Chrome), Opera (mirrors Chrome), Chrome for Android 132. Firefox and Safari: `version_added: false`.
Source: https://github.com/mdn/browser-compat-data/blob/main/api/Window.json (`api.Window.showDirectoryPicker`), rendered at https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker. MDN marks it "Limited availability", secure context only, and requires transient user activation.

`FileSystemFileHandle.createWritable`: Chrome 86, Firefox 111, Safari 26.
Source: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable (BCD `api.FileSystemFileHandle.createWritable`).

The Firefox and Safari numbers for `createWritable` do not help here. Both browsers ship no API that returns a handle to a file outside browser storage (no `showDirectoryPicker`, no `getAsFileSystemHandle`, see section 3), so the only handles you can call `createWritable` on in those browsers are OPFS handles.

caniuse lists the File System Access API as unsupported in every Firefox and Safari release, including Safari 26 and 27.x and Firefox through 159: https://caniuse.com/native-filesystem-api

Mozilla's position is "negative" (issue title "File System Access API", label `position: negative`). Martin Thomson: "the protections described in the spec are inadequate and I am of the opinion that this should be marked harmful." Source: https://github.com/mozilla/standards-positions/issues/154

WebKit's position is `position: oppose`, scoped to the local-file parts and excluding OPFS: https://github.com/WebKit/standards-positions/issues/28

The spec itself is a WICG Draft Community Group Report, not a W3C standard: https://wicg.github.io/file-system-access/

## 2. OPFS and FileSystemSyncAccessHandle

A distraction for this project. MDN: "Browsers persist the contents of the OPFS to disk somewhere, but you cannot expect to find the created files matched one-to-one. The OPFS is not intended to be visible to the user." It sits under the site storage quota and is wiped when site data is cleared.
Source: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system

`FileSystemSyncAccessHandle` is only available in dedicated workers on OPFS files: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API. Support is broad (Chrome 102, Firefox 111, Safari 15.2, BCD `api.FileSystemSyncAccessHandle`), and it is broad precisely because it never touches the user's checkout.

WebKit's blog post confirms their implementation covers OPFS only: https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/

## 3. Fallbacks for Firefox and Safari

Drag and drop, `DataTransferItem.getAsFileSystemHandle`: returns a `FileSystemDirectoryHandle` you could write through, but it is Chrome 86 and Edge only; Firefox and Safari do not implement it. Source: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle (BCD `api.DataTransferItem.getAsFileSystemHandle`).

Drag and drop, `DataTransferItem.webkitGetAsEntry`: Chrome 13, Edge 14, Firefox 50, Safari 11.1. Returns `FileSystemDirectoryEntry`; `createReader().readEntries()` walks the tree (Chromium returns at most 100 entries per call, so loop until empty). Read only; the entry API has no write path. Source: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry

`<input type="file" webkitdirectory>`: Chrome 7, Edge 13, Firefox 50, Safari 11.1. Gives a flat `FileList` where each `File.webkitRelativePath` carries the path relative to the chosen folder, so the tree can be rebuilt. Read only. Mobile support is recent and patchy (Safari iOS 18.4, Firefox Android 142, Chrome Android 132). Source: https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory

Zip round-trip: read via either method above, edit in memory, produce a zip and trigger a download. This is the only way to "save" in Firefox and Safari from page JS, and it saves to the Downloads folder, not in place. The user then has to unzip over their checkout. Reading works in all browsers; writing back in place does not.

Summary: in Firefox and Safari, every fallback can read a folder tree and none can write into it.

## 4. A file API on the Vite dev server

Vite plugins get a `configureServer(server)` hook. The docs: its purpose is "adding custom middlewares to the internal connect app", via `server.middlewares.use((req, res, next) => { ... })`. Middleware added there runs before Vite's internal middlewares; returning a function from the hook registers a post hook that runs after them. "configureServer is not called when running the production build."
Source: https://vite.dev/guide/api-plugin#configureserver

`ViteDevServer.middlewares` is typed `Connect.Server`: "A connect app instance. Can be used to attach custom middlewares to the dev server." Source: https://vite.dev/guide/api-javascript#vitedevserver

Because the plugin runs in Node, it can `fs.readdir`, `fs.readFile`, and `fs.writeFile` inside the project folder and expose that over `/__harnessy/files/...` on the same origin as the app. No CORS, no permission prompt, no browser feature gate. The app reads and writes the same files git tracks.

Constraints to design around: it exists only under `vite` (dev), so a built static bundle has no file access; and the plugin should confine paths to the project root and refuse `..` segments, since anything on localhost can hit it.

## 5. Persisting handles across reloads

The spec marks `FileSystemHandle` as Serializable, so handles can be stored in IndexedDB and posted between same-origin contexts. A handle read back from storage comes back in the "prompt" permission state, so the app must call `queryPermission()` and then `requestPermission()` (which needs transient user activation) before touching it. Sources: https://wicg.github.io/file-system-access/ and https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission

`queryPermission` and `requestPermission` are Chrome 86 and Edge only; Firefox and Safari do not implement them (BCD `api.FileSystemHandle.queryPermission` / `requestPermission`): https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle

Chrome 122 added persistent permissions. The prompt offers "Allow on every visit"; if the user picks it, a handle restored from IndexedDB and passed to `requestPermission()` regains access without a new picker. Installed PWAs persist automatically. Before that, access lasted until all tabs for the origin closed. Source: https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api and https://developer.chrome.com/docs/capabilities/web-apis/file-system-access

For the Vite-server approach none of this applies: the server knows the project root from `server.config.root`, so a reload needs no handle and no prompt.

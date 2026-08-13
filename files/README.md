# File Store

Files in this folder are uploaded from the iOS HTML Viewer app itself
(https://mmaggitti.github.io/ios-html-viewer/) via the GitHub Contents API, committed to
the `gh-pages` branch, and served publicly by GitHub Pages at
`https://mmaggitti.github.io/ios-html-viewer/files/<name>`.

`.jsx`/`.tsx` uploads get a companion `<name>.html` viewer page (a pre-built render shell)
so they too have a plain, pinnable path URL.

NOTE for maintenance: uploads land on `gh-pages` only, so it moves ahead of `main` —
deploy app changes with a regular merge of `main` into `gh-pages`, not fast-forward.

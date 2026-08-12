# iOS HTML Viewer

> from vscode Aug 14, 2024 : 8:57 PM

iOS HTML Viewer is a simple yet powerful tool that addresses the frustrating limitations of viewing local HTML files on iOS devices. The default iOS file previewer always strips out critical elements like external CSS and JavaScript, leaving users with a bland, static representation of their content. This tool allows you to fully render and interact with your HTML files directly on your iPhone or iPad, just as you would on a desktop browser.

## Why It's Needed

iOS support for viewing local HTML files is dismal. The built-in file previewer on iOS always removes external stylesheets and JavaScript, leaving users with a plain, non-interactive version of their content. While some third-party apps exist, they often come with intrusive ads, charge monthly subscriptions, or fail to fully support external assets. These solutions can be cumbersome, expensive, and privacy-invasive, making them less than ideal for users who just need a quick, reliable way to view their HTML content.

iOS HTML Viewer solves this problem by rendering the complete HTML content, including external CSS and JavaScript, right within your browser. It’s a straightforward, ad-free, and privacy-focused solution that ensures your HTML files are fully interactive and displayed as intended—all without the need for subscriptions or ads.

### Bonus Feature: View HTML Source Code with Syntax Highlighting

In addition to rendering your HTML files, iOS HTML Viewer offers an optional feature to view the source code of the uploaded file with **color syntax highlighting**. This is particularly useful for developers who want to inspect, debug, or review the HTML content. You can easily toggle between the rendered view and the syntax-highlighted source code, all within the same tool.

## Key Features

- **Full HTML Rendering**: Supports external CSS and JavaScript, providing a desktop-like viewing experience on iOS.
- **View Source Code with Syntax Highlighting**: Optionally view the raw HTML source code of your uploaded file, complete with color syntax highlighting.
- **Ad-Free and Subscription-Free**: No ads or hidden costs—just a simple, effective solution for viewing HTML files.
- **Privacy First**: Your uploaded HTML files are processed locally on your device, ensuring complete privacy and security.
- **Cross-Platform**: While designed for iOS, this viewer also works on other platforms like Android and desktop browsers.
- **Saved Files**: Save an HTML file into the browser's local storage on your device and reopen it any time from the Saved Files list — nothing is ever uploaded.
- **Home Screen Shortcuts**: Open a saved file, then Share → Add to Home Screen. The shortcut reopens that exact file directly, with its own icon (the file's initial, in the app's black-and-white style).
- **Portable Links**: For files under 64 KB, copy a self-contained link that embeds the entire document in the URL — it works on any device, independent of saved storage.

## License

This project is licensed under the MIT License.

---

## About this copy

This repository is a copy of [AImarkdown/ios-html-viewer](https://github.com/AImarkdown/ios-html-viewer)
(MIT License, © SimplerTasks Company — see [LICENSE](LICENSE)), deployed via GitHub Pages at:

**https://mmaggitti.github.io/ios-html-viewer/**

Changes from upstream:

- Asset paths made relative (required for a GitHub Pages project URL); Netlify badge removed.
- Pure black-and-white theme (black canvas, white text, monochrome buttons).
- New `</>` logo and icon set, regenerated from `icon-master.svg`.
- **Saved files + Home Screen shortcuts**: files persist in `localStorage`
  (`ioshtmlviewer.file.<name>`), reopened via `#/f/<name>` URLs; portable links embed the
  document base64url-encoded in `#/d/…` URLs (≤64 KB). The manifest declares
  `display: "browser"` deliberately — iOS gives standalone home-screen apps a storage
  container *separate* from Safari, so shortcuts must open in Safari to see saved files.
- Storage caveat: Safari deletes site storage after ~7 days of no visits (ITP). Regular use
  resets the clock; `navigator.storage.persist()` is requested; portable links are immune.

To redeploy after changes, push to the `gh-pages` branch.

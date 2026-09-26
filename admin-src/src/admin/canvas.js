import { FONTS_HREF } from '../shared/templates.js';
import { SITE_CSS, EDITOR_CSS, editorScriptURL } from './assets.js';

function escapeStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}

export function canvasDocument(scriptSrc) {
  return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<style id="site-css">
${escapeStyle(SITE_CSS)}
</style>
<style id="editor-css">
${escapeStyle(EDITOR_CSS)}
</style>
</head>
<body class="is-editing is-loading"><div id="ui-root"></div>
<script type="module" src="${scriptSrc}"></script>
</body></html>`;
}

/** One iframe for the whole session; documents are swapped inside it, never reloaded. */
export function createCanvas(container) {
  const iframe = document.createElement('iframe');
  iframe.className = 'canvas-frame';
  iframe.title = '页面编辑画布';
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
  container.appendChild(iframe);
  editorScriptURL().then(src => { iframe.srcdoc = canvasDocument(src); });
  return { iframe };
}

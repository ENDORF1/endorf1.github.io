import siteCss from '../shared/css/site.css?raw';
import editorCss from '../editor/editor.css?raw';
import editorBundle from 'virtual:editor-bundle';
import { base64ToBytes } from './crypto.js';

export const SITE_CSS = siteCss.trim();
export const EDITOR_CSS = editorCss.trim();

let urlPromise = null;

/** The editor runtime is shipped gzip+base64 inside admin.html and unpacked into a Blob URL. */
export function editorScriptURL() {
  if (urlPromise) return urlPromise;
  urlPromise = (async () => {
    if (!editorBundle) return new URL('/src/editor/entry.js', location.href).href;
    const bytes = base64ToBytes(editorBundle);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const js = await new Response(stream).blob();
    return URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  })();
  return urlPromise;
}

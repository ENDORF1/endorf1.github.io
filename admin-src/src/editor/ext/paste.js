import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { normalizeHTML } from '../../shared/normalize.js';

const MD_BLOCK = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~|\|.*\|\s*$|-{3,}\s*$|\[[ xX]\]\s)/m;
const MD_INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|!\[[^\]\n]*\]\([^)\s]+\))/g;

export function looksLikeMarkdown(text) {
  if (!text || text.length < 3) return false;
  const lines = text.split('\n');
  const blockHits = lines.filter(l => MD_BLOCK.test(l)).length;
  if (/^```/m.test(text) && /```\s*$/m.test(text)) return true;
  if (blockHits >= 2) return true;
  if (blockHits >= 1 && lines.length > 1) return true;
  const inline = (text.match(MD_INLINE) || []).length;
  return inline >= 2 || (inline >= 1 && lines.length > 1);
}

function imageOnlyHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const text = div.textContent.replace(/\s+/g, '');
  return !text && div.querySelectorAll('img').length <= 1;
}

export function PasteHandler(app) {
  return Extension.create({
    name: 'pasteHandler',
    priority: 1000,
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('pasteHandler'),
        props: {
          transformPastedHTML(html) {
            if (/data-pm-slice/.test(html)) return html;
            return normalizeHTML(html, { doc: document }).innerHTML;
          },
          transformPasted(slice) {
            const foreign = [];
            slice.content.descendants(node => {
              if (node.type.name === 'figure' && node.attrs.src && !app.isOwnImage(node.attrs.src)) foreign.push(node.attrs.src);
            });
            if (foreign.length) setTimeout(() => app.adoptForeignImages(foreign), 0);
            return slice;
          },
          handlePaste(view, event) {
            const cd = event.clipboardData;
            if (!cd) return false;
            const html = cd.getData('text/html');
            const text = cd.getData('text/plain');
            const files = [...cd.files].filter(f => f.type.startsWith('image/'));
            if (files.length && (!html || imageOnlyHTML(html))) {
              app.insertImageFiles(files, null);
              return true;
            }
            const inCode = view.state.selection.$from.parent.type.spec.code;
            if (inCode) return false;
            const vs = cd.getData('vscode-editor-data');
            if (vs && text && text.includes('\n')) {
              let mode = '';
              try { mode = JSON.parse(vs).mode || ''; } catch { /* ignore */ }
              app.pasteCode(text, mode);
              return true;
            }
            if (!html && text && looksLikeMarkdown(text)) {
              app.pasteMarkdown(text);
              return true;
            }
            if (!html && text && /^https?:\/\/\S+$/.test(text.trim()) && view.state.selection.empty) {
              const $from = view.state.selection.$from;
              if ($from.parent.type.name === 'paragraph' && !$from.parent.content.size && $from.depth === 1) {
                app.offerEmbed(text.trim(), $from.before());
              }
            }
            return false;
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) return false;
            const files = [...(event.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
            if (!files.length) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            app.insertImageFiles(files, at ? at.pos : null);
            return true;
          },
        },
      })];
    },
  });
}

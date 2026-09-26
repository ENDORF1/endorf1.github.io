import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { insertBlocks, turnInto } from '../commands.js';

export const slashKey = new PluginKey('slash');

const I = (id, group, title, icon, keys, run, extra = {}) => ({ id, group, title, icon, keys, run, ...extra });

export const SLASH_ITEMS = [
  I('paragraph', '基础', '正文', 'text', 'text paragraph zhengwen zw wenben', (ed, r) => turnInto(ed, 'paragraph', r)),
  I('h1', '基础', '一级标题', 'h1', 'h1 heading title biaoti bt yiji bt1 biaoti1 heading1 标题1', (ed, r) => turnInto(ed, 'h1', r), { kbd: 'Ctrl Alt 1' }),
  I('h2', '基础', '二级标题', 'h2', 'h2 heading title biaoti bt erji bt2 biaoti2 heading2 标题2', (ed, r) => turnInto(ed, 'h2', r), { kbd: 'Ctrl Alt 2' }),
  I('h3', '基础', '三级标题', 'h3', 'h3 heading title biaoti bt sanji bt3 biaoti3 heading3 标题3', (ed, r) => turnInto(ed, 'h3', r), { kbd: 'Ctrl Alt 3' }),
  I('h4', '基础', '四级标题', 'h4', 'h4 heading title biaoti bt siji bt4 biaoti4 heading4 标题4', (ed, r) => turnInto(ed, 'h4', r), { kbd: 'Ctrl Alt 4' }),
  I('bulletList', '基础', '无序列表', 'list', 'ul bullet list liebiao lb wuxu', (ed, r) => turnInto(ed, 'bulletList', r), { kbd: '- 空格' }),
  I('orderedList', '基础', '有序列表', 'ordered', 'ol ordered number list liebiao lb youxu yx', (ed, r) => turnInto(ed, 'orderedList', r), { kbd: '1. 空格' }),
  I('taskList', '基础', '任务列表', 'task', 'todo task checkbox check renwu rw daiban db', (ed, r) => turnInto(ed, 'taskList', r), { kbd: '[] 空格' }),
  I('blockquote', '基础', '引用', 'quote', 'quote blockquote yinyong yy', (ed, r) => turnInto(ed, 'blockquote', r), { kbd: '> 空格' }),
  I('callout', '基础', '高亮块', 'callout', 'callout tip note info warning gaoliang glk tishi ts', (ed, r) => turnInto(ed, 'callout', r)),
  I('codeBlock', '基础', '代码块', 'codeblock', 'code codeblock pre daima dm', (ed, r) => turnInto(ed, 'codeBlock', r), { kbd: '``` 空格' }),
  I('divider', '基础', '分割线', 'divider', 'hr divider line separator fengexian fgx', (ed, r) => insertBlocks(ed, r, [{ type: 'horizontalRule' }]), { kbd: '---' }),
  I('image', '插入', '图片', 'image', 'image img picture photo upload tupian tp shangchuan', (ed, r, app) => app.pickImages(r), { desc: '上传本地图片，也可以直接粘贴或拖入' }),
  I('library', '插入', '从图库选择', 'gallery', 'library media image tuku tk tupian', (ed, r, app) => app.pickFromLibrary(r), { desc: '使用已上传过的图片' }),
  I('table', '插入', '表格', 'table', 'table grid biaoge bg', (ed, r) => insertBlocks(ed, r, [tableJSON(3, 3)])),
  I('embed', '插入', '视频 / 网页', 'embed', 'video embed iframe bilibili youtube itch web shipin sp qianru qr wangye wy', (ed, r, app) => app.promptEmbed(r), { desc: 'B 站、YouTube、itch.io 或任意网页' }),
];

export function tableJSON(rows, cols) {
  const cell = type => ({ type, content: [{ type: 'paragraph' }] });
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, () => cell(r === 0 ? 'tableHeader' : 'tableCell')),
    })),
  };
}

export function filterSlashItems(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  const scored = [];
  for (const item of SLASH_ITEMS) {
    const title = item.title.toLowerCase();
    const words = item.keys.split(' ');
    let score = -1;
    if (title === q) score = 100;
    else if (title.startsWith(q)) score = 80;
    else if (title.includes(q)) score = 60;
    else if (words.some(w => w === q)) score = 50;
    else if (words.some(w => w.startsWith(q))) score = 40;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.item);
}

/** Latin letters, digits and URL punctuation right before "/" mean the user is typing a path, not a command. */
function slashAllowed({ state, range }) {
  const $from = state.doc.resolve(range.from);
  if ($from.parent.type.spec.code) return false;
  if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') return false;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, '', '\ufffc');
  return !before || !/[A-Za-z0-9:/.\\_\-=?&%#@]/.test(before);
}

export function SlashCommand(app) {
  return Extension.create({
    name: 'slashCommand',
    priority: 200,
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        allowedPrefixes: null,
        allowSpaces: false,
        decorationClass: 'slash-query',
        decorationEmptyClass: 'is-query-empty',
        allow: slashAllowed,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range, app),
        render: () => ({
          onStart: p => app.slash.open(p),
          onUpdate: p => app.slash.update(p),
          onExit: () => app.slash.close(),
          onKeyDown: ({ event }) => app.slash.keydown(event),
        }),
      })];
    },
  });
}

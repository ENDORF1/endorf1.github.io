export const TEXT_COLORS = [
  { id: 'default', label: '默认', value: null },
  { id: 'gray', label: '灰色', value: '#8aa4bd' },
  { id: 'red', label: '红色', value: '#ff5c7a' },
  { id: 'orange', label: '橙色', value: '#ff9f43' },
  { id: 'yellow', label: '黄色', value: '#ffe600' },
  { id: 'green', label: '绿色', value: '#3ddc97' },
  { id: 'cyan', label: '青色', value: '#00f5ff' },
  { id: 'blue', label: '蓝色', value: '#4d9fff' },
  { id: 'purple', label: '紫色', value: '#b388ff' },
  { id: 'magenta', label: '品红', value: '#ff006e' },
];

export const BG_COLORS = [
  { id: 'none', label: '无背景', value: null },
  { id: 'gray', label: '灰色背景', value: 'rgba(140,165,190,.2)' },
  { id: 'red', label: '红色背景', value: 'rgba(255,92,122,.22)' },
  { id: 'orange', label: '橙色背景', value: 'rgba(255,159,67,.22)' },
  { id: 'yellow', label: '黄色背景', value: 'rgba(255,230,0,.2)' },
  { id: 'green', label: '绿色背景', value: 'rgba(61,220,151,.2)' },
  { id: 'cyan', label: '青色背景', value: 'rgba(0,245,255,.16)' },
  { id: 'blue', label: '蓝色背景', value: 'rgba(77,159,255,.22)' },
  { id: 'purple', label: '紫色背景', value: 'rgba(179,136,255,.22)' },
];

export const CALLOUT_EMOJIS = ['💡', '📌', '⚠️', '❗', '✅', '❌', '❓', 'ℹ️', '🔥', '⭐', '📝', '📣', '🎮', '🎯', '🚀', '🧪', '💬', '🔧', '📦', '🧠', '🎨', '🕹️', '📖', '🔗'];

export const CALLOUT_COLOR_SWATCH = {
  cyan: '#00f5ff',
  magenta: '#ff006e',
  yellow: '#ffe600',
  green: '#3ddc97',
  purple: '#b388ff',
  gray: '#8ca5be',
};

export const BLOCK_TYPES = [
  { id: 'paragraph', icon: 'text', title: '正文' },
  { id: 'h1', icon: 'h1', title: '一级标题' },
  { id: 'h2', icon: 'h2', title: '二级标题' },
  { id: 'h3', icon: 'h3', title: '三级标题' },
  { id: 'h4', icon: 'h4', title: '四级标题' },
  { id: 'bulletList', icon: 'list', title: '无序列表' },
  { id: 'orderedList', icon: 'ordered', title: '有序列表' },
  { id: 'taskList', icon: 'task', title: '任务列表' },
  { id: 'blockquote', icon: 'quote', title: '引用' },
  { id: 'codeBlock', icon: 'codeblock', title: '代码块' },
  { id: 'callout', icon: 'callout', title: '高亮块' },
];

/** Which BLOCK_TYPES entry describes the block at the cursor. */
export function currentBlockType(editor) {
  if (!editor) return 'paragraph';
  if (editor.isActive('codeBlock')) return 'codeBlock';
  for (const l of [1, 2, 3, 4]) if (editor.isActive('heading', { level: l })) return 'h' + l;
  if (editor.isActive('taskList')) return 'taskList';
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('bulletList')) return 'bulletList';
  if (editor.isActive('callout')) return 'callout';
  if (editor.isActive('blockquote')) return 'blockquote';
  return 'paragraph';
}

export function blockTypeOfNode(node) {
  if (!node) return 'paragraph';
  const n = node.type.name;
  if (n === 'heading') return 'h' + node.attrs.level;
  if (n === 'listItem') return 'bulletList';
  if (n === 'taskItem') return 'taskList';
  return n;
}

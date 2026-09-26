import { createLowlight, common } from 'lowlight';
import glsl from 'highlight.js/lib/languages/glsl';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import cmake from 'highlight.js/lib/languages/cmake';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

export const lowlight = createLowlight({ ...common, glsl, powershell, dos, cmake, dockerfile });

export const LANGUAGES = [
  ['plaintext', '纯文本', 'text txt'],
  ['csharp', 'C#', 'cs unity'],
  ['cpp', 'C++', 'c++ cc hpp'],
  ['c', 'C', 'h'],
  ['javascript', 'JavaScript', 'js jsx'],
  ['typescript', 'TypeScript', 'ts tsx'],
  ['python', 'Python', 'py'],
  ['lua', 'Lua', ''],
  ['glsl', 'GLSL', 'shader hlsl'],
  ['java', 'Java', ''],
  ['kotlin', 'Kotlin', 'kt'],
  ['go', 'Go', 'golang'],
  ['rust', 'Rust', 'rs'],
  ['swift', 'Swift', ''],
  ['json', 'JSON', ''],
  ['yaml', 'YAML', 'yml'],
  ['ini', 'INI / TOML', 'toml cfg'],
  ['xml', 'HTML / XML', 'html svg'],
  ['css', 'CSS', ''],
  ['scss', 'SCSS', 'sass'],
  ['less', 'Less', ''],
  ['markdown', 'Markdown', 'md'],
  ['bash', 'Bash', 'sh zsh'],
  ['shell', 'Shell 会话', 'console'],
  ['powershell', 'PowerShell', 'ps ps1'],
  ['dos', 'Batch', 'bat cmd'],
  ['sql', 'SQL', ''],
  ['php', 'PHP', ''],
  ['ruby', 'Ruby', 'rb'],
  ['r', 'R', ''],
  ['diff', 'Diff', 'patch'],
  ['graphql', 'GraphQL', 'gql'],
  ['makefile', 'Makefile', 'make'],
  ['cmake', 'CMake', ''],
  ['dockerfile', 'Dockerfile', 'docker'],
  ['objectivec', 'Objective-C', 'objc'],
  ['vbnet', 'VB.NET', 'vb'],
  ['perl', 'Perl', 'pl'],
].map(([id, label, aliases]) => ({ id, label, aliases }));

const LABELS = Object.fromEntries(LANGUAGES.map(l => [l.id, l.label]));

export function languageLabel(id) {
  if (!id || id === 'plaintext') return '';
  return LABELS[id] || id.toUpperCase();
}

export function resolveLanguage(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase().replace(/^language-/, '');
  if (!n) return null;
  const direct = LANGUAGES.find(l => l.id === n || l.label.toLowerCase() === n);
  if (direct) return direct.id;
  const alias = LANGUAGES.find(l => l.aliases.split(' ').includes(n));
  if (alias) return alias.id;
  if (lowlight.registered(n)) return n;
  return null;
}

function flatten(nodes, classes = [], out = []) {
  for (const node of nodes) {
    const cls = node.properties && node.properties.className ? [...classes, ...node.properties.className] : classes;
    if (node.children) flatten(node.children, cls, out);
    else out.push({ text: node.value, classes: cls });
  }
  return out;
}

export function highlightSegments(text, language) {
  const known = language && (lowlight.listLanguages().includes(language) || lowlight.registered(language));
  const tree = known ? lowlight.highlight(language, text) : lowlight.highlightAuto(text);
  return flatten(tree.children || []);
}

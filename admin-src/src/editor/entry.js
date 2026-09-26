import { EditorApp } from './app.js';
import { installAutoFocus } from '../shared/autofocus.js';

installAutoFocus();
const host = window.parent && window.parent !== window ? window.parent.__devlogHost : null;
if (host) {
  const app = new EditorApp(host);
  window.__devlogEditor = app;
  host.attach(app.api(), window);
} else {
  document.body.textContent = '编辑器需要在后台页面里打开。';
}

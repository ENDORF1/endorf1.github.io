import { render } from 'preact';
import './admin.css';
import { Shell } from './shell.js';
import { App } from './ui/App.jsx';
import { installAutoFocus } from '../shared/autofocus.js';

installAutoFocus();
const shell = new Shell();
window.__devlogShell = shell;
render(<App shell={shell} />, document.getElementById('app'));

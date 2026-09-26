import { JSDOM } from 'jsdom';

// jsdom uses parse5, so malformed legacy HTML parses exactly as it does in a browser.
export function createWindow() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://endorf1.github.io/' });
  return dom.window;
}

export function parsePage(window, html) {
  return new window.DOMParser().parseFromString(html, 'text/html');
}

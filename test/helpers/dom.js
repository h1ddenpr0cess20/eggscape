import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const INDEX = fileURLToPath(new URL('../../index.html', import.meta.url));

let markup;

export async function loadPage() {
  markup ??= await readFile(INDEX, 'utf8');

  const dom = new JSDOM(markup, { runScripts: 'outside-only', pretendToBeVisual: true });

  return {
    dom,
    document: dom.window.document,
    window: dom.window,
    $: (sel) => dom.window.document.querySelector(sel),
    close: () => dom.window.close(),
  };
}

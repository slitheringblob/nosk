import 'fake-indexeddb/auto';
import createDOMPurify from 'dompurify';

window.DOMPurify = createDOMPurify(window);
// jsdom lacks these; components only use them for layout niceties.
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.requestAnimationFrame = window.requestAnimationFrame;
document.execCommand = () => true;
HTMLElement.prototype.scrollIntoView = () => {};
if (!globalThis.structuredClone) globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));

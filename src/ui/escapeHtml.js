const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Section renderers build markup from content.js strings via innerHTML -
// escape them so a stray "<" or "&" in the copy can't break the markup.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

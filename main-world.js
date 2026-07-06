// main-world.js - Runs in LeetCode's MAIN world context to access window.monaco

window.addEventListener('LEETCODE_TRACKER_REQUEST_CODE', (e) => {
  const { eventName } = e.detail || {};
  if (!eventName) return;

  let code = '';
  try {
    if (window.monaco?.editor?.getEditors()?.length > 0) {
      code = window.monaco.editor.getEditors()[0].getValue();
    }
  } catch (err) {
    console.error('[LeetCode Tracker Main World] Error reading Monaco:', err);
  }

  // Dispatch the response event containing the code text
  window.dispatchEvent(new CustomEvent(eventName, { detail: code }));
});

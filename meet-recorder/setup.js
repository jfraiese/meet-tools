// Microphone permission is bound to the extension's origin, and can only be
// requested from a page with UI. An offscreen document has none, so this page
// is the only place the prompt can happen.

const status = document.getElementById('status');

document.getElementById('grant').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    await chrome.storage.local.set({ micGranted: true });
    status.textContent = 'Granted. You can close this tab and start recording from a Meet.';
    status.className = 'ok';
  } catch (err) {
    await chrome.storage.local.set({ micGranted: false });
    status.textContent =
      `Denied (${err.name}). Recordings would capture the other participants but not you. ` +
      'Re-allow the microphone for this extension in Chrome settings, then click again.';
    status.className = 'bad';
  }
});

// Shared supervisor-PIN gate, used by the hub and the history page.
//
// The PIN lives in localStorage, so it's typed once per device. If you act while
// locked (or with a stale PIN), the keypad opens and the action you were trying
// to do is retried automatically once you unlock — `await action(...)` still
// resolves with the result, so callers don't need to care that we detoured.
window.SnapBoxPin = (function () {
  const lockBtn = document.getElementById('lockBtn');
  const pinModal = document.getElementById('pinModal');
  const pinForm = document.getElementById('pinForm');
  const pinInput = document.getElementById('pinInput');
  const pinErr = document.getElementById('pinErr');
  const pinCancel = document.getElementById('pinCancel');

  let pinRequired = false;
  let pending = null; // { retry, resolve } — what we were doing when we asked
  let onStatus = () => {};

  const getPin = () => localStorage.getItem('snapbox_pin') || '';

  function setPin(p) {
    if (p) localStorage.setItem('snapbox_pin', p);
    else localStorage.removeItem('snapbox_pin');
    updateLock();
  }

  function updateLock() {
    if (!lockBtn) return;
    const unlocked = !!getPin();
    lockBtn.className = 'lock ' + (unlocked ? 'unlocked' : 'locked');
    lockBtn.textContent = unlocked ? '🔓 Unlocked' : '🔒 Locked';
    lockBtn.hidden = !pinRequired;
  }

  // Park the caller's action, ask for the PIN, and resolve once it's done.
  function askForPin(retry, wrong) {
    return new Promise((resolve) => {
      pending = { retry, resolve };
      pinErr.hidden = !wrong;
      pinInput.value = '';
      pinModal.hidden = false;
      setTimeout(() => pinInput.focus(), 50);
    });
  }

  function abandon() {
    const p = pending;
    pending = null;
    pinModal.hidden = true;
    if (p) p.resolve(undefined);
  }

  if (pinForm) {
    pinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entered = pinInput.value.trim();
      if (!entered) return;
      pinInput.blur(); // drop the on-screen keyboard before anything else
      setPin(entered);
      pinModal.hidden = true;
      const p = pending;
      pending = null;
      if (p) p.resolve(await p.retry()); // finish what they were doing
    });
  }
  if (pinCancel) pinCancel.addEventListener('click', abandon);
  if (pinModal) {
    pinModal.addEventListener('click', (e) => { if (e.target === pinModal) abandon(); });
  }
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (getPin()) {
        if (confirm('Lock SnapBox — forget the PIN on this device?')) setPin('');
      } else {
        askForPin(async () => undefined, false);
      }
    });
  }

  // Never throws. Returns the parsed JSON on success, undefined otherwise.
  async function action(method, url, body) {
    if (pinRequired && !getPin()) {
      return askForPin(() => action(method, url, body), false);
    }

    const headers = {};
    const p = getPin();
    if (p) headers['x-snapbox-pin'] = p;
    if (body) headers['Content-Type'] = 'application/json';

    let r;
    try {
      r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      onStatus('Network error', 'err');
      return;
    }

    if (r.status === 401) {
      setPin(''); // stored PIN is wrong — forget it and ask again
      return askForPin(() => action(method, url, body), true);
    }
    if (!r.ok) {
      onStatus('Action failed', 'err');
      return;
    }
    return r.json();
  }

  return {
    init(opts) {
      pinRequired = !!(opts && opts.required);
      onStatus = (opts && opts.onStatus) || (() => {});
      updateLock();
    },
    action,
    getPin,
  };
})();

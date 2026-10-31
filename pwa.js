/** Progressive enhancement: installation is exposed to the UI, never prompted
 * automatically. A new worker is activated only while transport is stopped. */
export function setupPWA({isPlaying = () => false, onToast = () => {}} = {}) {
  let registration = null;
  let installPrompt = null;
  let pendingReload = false;
  let activationRequested = false;
  let destroyed = false;
  let reloadStarted = false;
  let announcedUpdate = false;
  const hadController = Boolean(navigator.serviceWorker?.controller);
  const emit = () => window.dispatchEvent(new CustomEvent('duo:pwa', {
    detail: {canInstall: Boolean(installPrompt), updateReady: Boolean(registration?.waiting)}
  }));

  const reloadWhenIdle = () => {
    if (destroyed || isPlaying()) return;
    if (pendingReload && !reloadStarted) {
      reloadStarted = true;
      location.reload();
      return;
    }
    if (registration?.waiting && !activationRequested) {
      activationRequested = true;
      registration.waiting.postMessage({type: 'ACTIVATE_IDLE_UPDATE'});
    }
  };

  const beforeInstall = event => {
    event.preventDefault();
    installPrompt = event;
    emit();
  };
  const installed = () => {
    installPrompt = null;
    onToast('DUO added to your home screen');
    emit();
  };
  const controllerChanged = () => {
    if (!hadController) return;
    pendingReload = true;
    reloadWhenIdle();
  };
  const checkWaiting = () => {
    if (!registration?.waiting) return;
    emit();
    if (isPlaying() && !announcedUpdate) {
      announcedUpdate = true;
      onToast('Update ready · applies when playback stops');
    }
    reloadWhenIdle();
  };

  window.addEventListener('beforeinstallprompt', beforeInstall);
  window.addEventListener('appinstalled', installed);
  document.addEventListener('visibilitychange', reloadWhenIdle);
  window.addEventListener('duo:transport', reloadWhenIdle);
  const interval = window.setInterval(reloadWhenIdle, 2000);

  const ready = 'serviceWorker' in navigator && window.isSecureContext
    ? navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
      .then(value => {
        registration = value;
        checkWaiting();
        registration.addEventListener('updatefound', () => {
          activationRequested = false;
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed') checkWaiting();
          });
        });
        return registration;
      }).catch(() => {
        // Synthesis remains fully usable if storage or worker registration is blocked.
        return null;
      })
    : Promise.resolve(null);
  navigator.serviceWorker?.addEventListener('controllerchange', controllerChanged);

  return {
    ready,
    get canInstall() { return Boolean(installPrompt); },
    get installed() {
      return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    },
    async checkUpdate() {
      const active = registration || await ready;
      if (!active) return false;
      await active.update();
      checkWaiting();
      return Boolean(active.waiting);
    },
    async install() {
      if (!installPrompt) {
        onToast('In Safari, use Share → Add to Home Screen');
        return false;
      }
      const event = installPrompt;
      installPrompt = null;
      await event.prompt();
      const choice = await event.userChoice;
      emit();
      return choice.outcome === 'accepted';
    },
    applyUpdateIfIdle: reloadWhenIdle,
    destroy() {
      destroyed = true;
      window.clearInterval(interval);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
      document.removeEventListener('visibilitychange', reloadWhenIdle);
      window.removeEventListener('duo:transport', reloadWhenIdle);
      navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
    }
  };
}

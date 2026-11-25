// Installable-app support: registers the service worker and exposes the
// browser's "install" prompt so the app can offer its own Install button.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(Boolean(deferredPrompt)));

export function setupPwa() {
  if (typeof window === "undefined") return;
  // Only in production builds: a service worker would get in the way of the dev server.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export const isInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export const isIos = () =>
  typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

export function onInstallAvailable(fn) {
  listeners.add(fn);
  fn(Boolean(deferredPrompt));
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome === "accepted";
}

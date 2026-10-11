// PlantOps service worker: shows phone notifications (Web Push) and opens them when tapped.
// Nothing is cached here: PlantOps has no offline mode in v1.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PlantOps", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "PlantOps", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag, // the same notification never shows twice
      data: { url: data.url || "/home" },
    }),
  );
});

// Tap: reuse an open PlantOps window if there is one, else open a new one. /n/<id> marks it read and goes on
// to the module page through the normal login.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/home", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "navigate" in w) {
          await w.focus();
          return w.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

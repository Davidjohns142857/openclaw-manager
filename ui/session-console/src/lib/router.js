// Minimal hash-based router. No dependencies.

const routes = [];
let currentCleanup = null;

export function on(pattern, handler) {
  // Convert "/sessions/:session_id/runs/:run_id" → regex + param names
  const paramNames = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  routes.push({ regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

export function navigate(path) {
  window.location.hash = path;
}

function resolve() {
  const hash = window.location.hash.slice(1) || "/";

  for (const route of routes) {
    const match = hash.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      // Clean up previous page (stop polling etc.)
      if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
      }

      // Run handler, which may return a cleanup function
      const cleanup = route.handler(params);
      if (typeof cleanup === "function") {
        currentCleanup = cleanup;
      }

      updateActiveNavLink(hash);
      return;
    }
  }

  // 404 fallback
  document.getElementById("app").innerHTML =
    `<div class="empty-state">Page not found: ${hash}</div>`;
}

function updateActiveNavLink(hash) {
  document.querySelectorAll(".nav-link").forEach(link => {
    const route = link.dataset.route;
    if (route === "/" && hash === "/") {
      link.classList.add("active");
    } else if (route !== "/" && hash.startsWith(route)) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

export function start() {
  window.addEventListener("hashchange", resolve);
  resolve();
}

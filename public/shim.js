// Compatibility shim: provides window.claude.use("db" | "user" | "assets" | "sample")
// backed by this server's REST API, so the unmodified Artifact page runs standalone.
(function () {
  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body == null ? undefined : { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      credentials: "same-origin"
    });
    if (!r.ok) throw { code: r.status === 401 ? "invalid_argument" : "unavailable", message: "HTTP " + r.status };
    return r.json();
  }

  // ---- document store (polling stands in for realtime snapshots) ----
  const subs = new Map();
  let pollTimer = null;
  async function pollOne(p) {
    const rec = subs.get(p);
    if (!rec || !rec.cbs.length) return;
    try {
      const { docs } = await api("GET", "/api/col/" + p);
      const snap = {
        metadata: { fromCache: false, hasPendingWrites: false },
        docs: docs.map(d => ({ id: d.id, exists: true, data: () => d.data, metadata: { fromCache: false, hasPendingWrites: false } }))
      };
      rec.errored = false;
      rec.cbs.forEach(cb => cb.next(snap));
    } catch (e) {
      if (!rec.errored) {
        rec.errored = true;
        rec.cbs.forEach(cb => cb.error && cb.error({ code: e.code || "unavailable", message: e.message || "" }));
      }
    }
  }
  function ensurePolling() {
    if (!pollTimer) pollTimer = setInterval(() => subs.forEach((_, p) => pollOne(p)), 8000);
  }
  function colRef(p) {
    return {
      path: p,
      onSnapshot(next, error) {
        ensurePolling();
        let rec = subs.get(p);
        if (!rec) { rec = { cbs: [], errored: false }; subs.set(p, rec); }
        const cb = { next, error };
        rec.cbs.push(cb);
        pollOne(p);
        return () => { rec.cbs = rec.cbs.filter(x => x !== cb); };
      },
      doc(id) { return docRef(p + "/" + (id || crypto.randomUUID())); },
      async add(data) { const r = await api("POST", "/api/col/" + p, data); pollOne(p); return docRef(p + "/" + r.id); }
    };
  }
  function docRef(p) {
    const col = p.slice(0, p.lastIndexOf("/"));
    return {
      id: p.slice(p.lastIndexOf("/") + 1),
      path: p,
      async set(d) { await api("PUT", "/api/doc/" + p, d); pollOne(col); },
      async update(d) { await api("PATCH", "/api/doc/" + p, d); pollOne(col); },
      async delete() { await api("DELETE", "/api/doc/" + p); pollOne(col); },
      collection(sub) { return colRef(p + "/" + sub); }
    };
  }
  const dbNs = { collection: colRef, doc: docRef };

  // ---- viewer identity / access level ----
  let role = null;
  const uid = (() => {
    try {
      let u = localStorage.getItem("ops_uid");
      if (!u) { u = "u_" + crypto.randomUUID().replace(/-/g, "").slice(0, 22); localStorage.setItem("ops_uid", u); }
      return u;
    } catch (e) { return null; }
  })();
  const userNs = {
    id: async () => uid,
    isOwner: async () => role === "admin",
    canEdit: async () => role === "admin",
    can: async n => n === "data.write" ? role !== null : role === "admin",
    me: async () => ({ id: uid, name: "", avatarUrl: "", color: "#888", email: null, isOwner: role === "admin", canEdit: role === "admin" }),
    profiles: async ids => Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map(i => [i, { id: i, name: "", avatarUrl: "", color: "#888", email: null, isMe: i === uid, guest: false }]))
  };

  // ---- file store ----
  const assetsNs = {
    async upload(file) {
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name || "file") },
        body: file,
        credentials: "same-origin"
      });
      if (!r.ok) throw { code: "upload_failed", message: "HTTP " + r.status };
      return r.json();
    },
    async delete(id) { await api("DELETE", "/api/blob/" + id); },
    async list() { return { assets: [], usage: {} }; }
  };

  // ---- certificate reading (server-side Anthropic call) ----
  let ocr = false;
  function sampleFn() { return Promise.reject({ code: "not_granted", message: "text sampling not available here" }); }
  sampleFn.limits = async () => ({
    maxPromptBytes: 262144,
    ...(ocr ? { images: { maxCount: 1, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } } : {})
  });
  sampleFn.json = async (prompt, opts) => {
    const img = opts && opts.images && (opts.images[0] || opts.images);
    if (!img) throw { code: "invalid_request", message: "image required" };
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = rej;
      fr.readAsDataURL(img);
    });
    const r = await api("POST", "/api/ocr", { prompt, media_type: img.type || "image/jpeg", data: b64 });
    if (r.json == null) throw { code: "invalid_json", message: "no JSON in reply" };
    return r.json;
  };

  // ---- boot ----
  const ready = (async () => {
    try { role = (await (await fetch("/api/me", { credentials: "same-origin" })).json()).role; } catch (e) {}
    try { ocr = !!(await (await fetch("/api/config")).json()).ocr; } catch (e) {}
  })();

  window.claude = {
    use: async name => {
      await ready;
      if (name === "db") return role ? dbNs : null;
      if (name === "user") return userNs;
      if (name === "assets") return role ? assetsNs : null;
      if (name === "sample") return ocr && role ? sampleFn : null;
      return null;
    }
  };

  // ---- sign in / out button ----
  addEventListener("DOMContentLoaded", async () => {
    await ready;
    const b = document.createElement("button");
    b.textContent = role ? (role === "admin" ? "Manager" : "Crew") + " · sign out" : "🔑 Sign in";
    b.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:50;padding:8px 14px;border-radius:999px;border:1px solid #889;background:#fff;color:#223;cursor:pointer;font:600 13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.18)";
    b.onclick = async () => {
      if (role) { document.cookie = "ops=; Max-Age=0; path=/"; location.reload(); return; }
      const code = prompt("Enter your team's access code:");
      if (!code) return;
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!r.ok) { alert("That code is not right."); return; }
      document.cookie = "ops=" + encodeURIComponent(code) + "; path=/; max-age=31536000; SameSite=Lax";
      location.reload();
    };
    document.body.appendChild(b);
    // The page's offline wording mentions claude.ai; point people at the button instead.
    if (!role) {
      const fix = setInterval(() => {
        const n = document.getElementById("notice");
        if (n && /claude\.ai/.test(n.textContent)) {
          n.textContent = "Sign in to load the shared register — click the 🔑 Sign in button (bottom left) and enter your team's access code.";
          clearInterval(fix);
        }
      }, 500);
      setTimeout(() => clearInterval(fix), 15000);
    }
  });
})();

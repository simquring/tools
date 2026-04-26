(function () {
  "use strict";

  // ================= CONFIG =================
  const CONFIG = Object.freeze({
    storageKey: "api_keys",
    rotationKey: "auto_rotation",
    currentKeyIndex: "current_key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/",
    maxRetries: 3,
    retryDelay: 1000,
  });

  // ================= STORAGE =================
  const Storage = {
    get(key, fallback = null) {
      try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  // ================= API KEY MANAGER =================
  class APIKeyManager {
    constructor() {
      this.keys = Storage.get(CONFIG.storageKey, []);
      this.autoRotation = Storage.get(CONFIG.rotationKey, true);
      this.currentIndex = parseInt(localStorage.getItem(CONFIG.currentKeyIndex) || "0");
    }

    save() {
      Storage.set(CONFIG.storageKey, this.keys);
      localStorage.setItem(CONFIG.currentKeyIndex, this.currentIndex);
      Storage.set(CONFIG.rotationKey, this.autoRotation);
    }

    add(key) {
      const k = key.trim();

      if (!k || k.length < 20) throw new Error("API Key tidak valid");
      if (this.keys.some(x => x.key === k)) throw new Error("API Key sudah ada");

      this.keys.push({
        id: Date.now().toString(),
        key: k,
        status: "unchecked",
      });

      this.save();
    }

    delete(id) {
      this.keys = this.keys.filter(k => k.id !== id);
      if (this.currentIndex >= this.keys.length) this.currentIndex = 0;
      this.save();
    }

    getList() {
      const valid = this.keys.filter(k => k.status === "valid");
      return valid.length ? valid : this.keys;
    }

    getCurrent() {
      const list = this.getList();
      if (!list.length) return null;

      if (this.currentIndex >= list.length) this.currentIndex = 0;
      return list[this.currentIndex];
    }

    rotate() {
      const list = this.getList();
      if (!this.autoRotation || list.length <= 1) return false;

      this.currentIndex = (this.currentIndex + 1) % list.length;
      this.save();
      return true;
    }

    async check(id) {
      const item = this.keys.find(k => k.id === id);
      if (!item) return;

      try {
        const res = await fetch(
          `${CONFIG.baseUrl}${CONFIG.model}:generateContent?key=${item.key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "test" }] }],
            }),
          }
        );

        if (res.ok) item.status = "valid";
        else if (res.status === 429) item.status = "limit";
        else item.status = "invalid";
      } catch {
        item.status = "invalid";
      }

      this.save();
      return item.status;
    }
  }

  // ================= API =================
  async function callAPI(prompt, apiKey) {
    const url = `${CONFIG.baseUrl}${CONFIG.model}:generateContent?key=${apiKey}`;

    for (let i = 0; i < CONFIG.maxRetries; i++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });

        if (!res.ok) {
          if (res.status === 429) throw new Error("RATE_LIMIT");
          throw new Error("API Error");
        }

        const data = await res.json();
        return data.candidates[0].content.parts[0].text;
      } catch (e) {
        if (e.message === "RATE_LIMIT") throw e;
        if (i === CONFIG.maxRetries - 1) throw e;

        await new Promise(r => setTimeout(r, CONFIG.retryDelay));
      }
    }
  }

  // ================= PARSER =================
  function parseResponse(text) {
    const title = text.match(/<judul>([\s\S]*?)<\/judul>/i);
    const body = text.match(/<isi>([\s\S]*?)<\/isi>/i);

    return {
      judul: title ? title[1].split("|").map(x => x.trim()) : [],
      isi: body ? body[1].trim() : text,
    };
  }

  // ================= UI =================
  class UI {
    constructor() {
      this.api = new APIKeyManager();
      this.init();
    }

    init() {
      this.output = document.getElementById("output-content");
      this.btn = document.getElementById("btn-generate");
      this.topic = document.getElementById("topic");

      this.btn.onclick = () => this.generate();
    }

    mask(key) {
      if (!key) return "";
      return key.slice(0, 8) + "••••••••" + key.slice(-4);
    }

    setLoading(v) {
      this.btn.disabled = v;
    }

    async generate() {
      const key = this.api.getCurrent();
      if (!key) return alert("Tambahkan API Key");

      const topic = this.topic.value.trim();
      if (!topic) return alert("Isi topik dulu");

      this.setLoading(true);

      try {
        const text = await callAPI(topic, key.key);
        const parsed = parseResponse(text);

        this.output.innerHTML = parsed.isi.replace(/\n/g, "<br>");
      } catch (e) {
        if (e.message === "RATE_LIMIT") {
          key.status = "limit";
          this.api.save();

          if (this.api.rotate()) {
            setTimeout(() => this.generate(), 800);
            return;
          }
        }

        this.output.innerHTML = `<div style="color:red">${e.message}</div>`;
      } finally {
        this.setLoading(false);
      }
    }
  }

  // ================= INIT =================
  document.addEventListener("DOMContentLoaded", () => {
    window.uiController = new UI();
  });

})();

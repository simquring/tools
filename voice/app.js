(function () {
  "use strict";

  // ================= CONFIG =================
  const CONFIG = {
    storageKey: "api_keys",
    rotationKey: "auto_rotation",
    currentKeyIndex: "current_key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/",
    maxRetries: 3,
    retryDelay: 1000,
  };

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
      Storage.set(CONFIG.rotationKey, this.autoRotation);
      localStorage.setItem(CONFIG.currentKeyIndex, this.currentIndex);
    }

    addKey(key) {
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

    deleteKey(id) {
      this.keys = this.keys.filter(k => k.id !== id);
      if (this.currentIndex >= this.keys.length) this.currentIndex = 0;
      this.save();
    }

    getActiveList() {
      const valid = this.keys.filter(k => k.status === "valid");
      return valid.length ? valid : this.keys;
    }

    getCurrentKey() {
      const list = this.getActiveList();
      if (!list.length) return null;

      if (this.currentIndex >= list.length) this.currentIndex = 0;
      return list[this.currentIndex];
    }

    rotate() {
      const list = this.getActiveList();
      if (!this.autoRotation || list.length <= 1) return false;

      this.currentIndex = (this.currentIndex + 1) % list.length;
      this.save();
      return true;
    }

    async checkKey(id) {
      const key = this.keys.find(k => k.id === id);
      if (!key) return;

      try {
        const res = await fetch(
          `${CONFIG.baseUrl}${CONFIG.model}:generateContent?key=${key.key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "test" }] }],
            }),
          }
        );

        if (res.ok) key.status = "valid";
        else if (res.status === 429) key.status = "limit";
        else key.status = "invalid";
      } catch {
        key.status = "invalid";
      }

      this.save();
      return key.status;
    }
  }

  // ================= API CALL =================
  async function callGemini(prompt, apiKey) {
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
      judul: title ? title[1].split("|").map(t => t.trim()) : [],
      isi: body ? body[1].trim() : text,
    };
  }

  // ================= UI CONTROLLER =================
  class UIController {
    constructor() {
      this.api = new APIKeyManager();
      this.init();
    }

    init() {
      this.btn = document.getElementById("btn-generate");
      this.topic = document.getElementById("topic");
      this.output = document.getElementById("output-content");

      this.btn.addEventListener("click", () => this.generate());
    }

    mask(key) {
      return key.slice(0, 8) + "••••••••" + key.slice(-4);
    }

    setLoading(v) {
      this.btn.disabled = v;
    }

    async generate() {
      const key = this.api.getCurrentKey();
      if (!key) return alert("Tambahkan API Key dulu");

      const topic = this.topic.value.trim();
      if (!topic) return alert("Isi topik dulu");

      this.setLoading(true);

      try {
        const text = await callGemini(topic, key.key);
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
    window.uiController = new UIController();
  });

})();

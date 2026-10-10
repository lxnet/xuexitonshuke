// utils.js - 基础配置（刷课专精版）

// 平台检测：按域名分发对应适配器（?platform= 参数仅供测试/调试覆盖）
const Platform = {
    current: function () {
        try {
            const p = new URLSearchParams(location.search).get('platform');
            if (p === 'zhihuishu' || p === 'chaoxing') return p;
        } catch (e) {}
        const host = location.hostname || '';
        if (/zhihuishu\.com$/i.test(host)) return 'zhihuishu';
        if (/(chaoxing|xuexitong|erya100)\.com$/i.test(host)) return 'chaoxing';
        return null;
    },
    isZhs: function () { return this.current() === 'zhihuishu'; }
};

const State = {
    get: (cb) => {
        if (!chrome.runtime?.id) return cb({});
        try { chrome.storage.local.get(null, (res) => cb(res || {})); } catch(e) { cb({}); }
    },
    set: (data, cb) => {
        if (!chrome.runtime?.id) return;
        try { chrome.storage.local.set(data, cb); } catch(e) {}
    },
    remove: (keys, cb) => {
        if (!chrome.runtime?.id) return;
        try { chrome.storage.local.remove(keys, cb); } catch(e) {}
    }
};

const KEYS = {
    IS_LEARN_MODE: "cx_is_learn_mode",
    IS_LEARN_RUNNING: "cx_learn_run",
    VIDEO_DONE_PCT: "cx_video_done_pct",
    QUIZ_QUESTIONS: "cx_quiz_questions",
    AI_ENABLED: "cx_ai_enabled",
    AI_BASE_URL: "cx_ai_base_url",
    AI_API_KEY: "cx_ai_api_key",
    AI_MODEL: "cx_ai_model",
    AI_PRESET_CLEANED: "cx_ai_preset_cleaned",
    QUIZ_DONE_FLAG: "cx_quiz_done",
    AI_CACHE: "cx_ai_cache",
    DISCLAIMER_AGREED: "cx_disclaimer_agreed",
    RND_DONE: "cx_rnd_done",
    RND_BLUR: "cx_rnd_blur",
    STEALTH: "cx_stealth",
    BRUTAL: "cx_brutal_mode"
};

const Utils = {
    /**
     * 安全点击：触发元素的 onclick/jQuery 处理器，但阻止 javascript: href 的默认导航。
     * 学习通页面 CSP 禁止 javascript: URL，直接 click() 会刷 CSP 报错（功能虽不受影响）。
     */
    safeClick: (el) => {
        if (!el) return;
        try {
            el.addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true });
        } catch (e) {}
        el.click();
    },
    normalizeText: (text) => {
        if (!text) return "";
        return text.replace(/\s+/g, "").replace(/^[0-9]+[\.、]/, "").replace(/【.*?】/g, "").replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").replace(/[（].*?[）]/g, "").replace(/[,，。、:：\?？!！]/g, "").trim().toUpperCase();
    },
    flashBorder: (color = "#4CAF50") => {
        if (document.body) {
            const original = document.body.style.border;
            document.body.style.border = `4px solid ${color}`;
            setTimeout(() => { document.body.style.border = original; }, 500);
        }
    }
};

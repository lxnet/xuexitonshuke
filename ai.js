// ai.js - AI 自动答题（OpenAI 兼容接口，只选不交）
const AIBrain = {
    _running: false,
    _done: false,
    _lastResult: null,
    // 超强模式答题节奏区间（毫秒），测试可压缩
    STEALTH_PER_QUESTION: [3000, 15000],
    STEALTH_BEFORE_SUBMIT: [5000, 20000],
    // 暴力枚举节奏（短间隔，接近暴力模式）
    BRUTAL_ENUM_DELAY: [400, 1200],

    _randDelay: function (range) {
        const [a, b] = range;
        return a + Math.floor(Math.random() * (b - a + 1));
    },

    SYSTEM_PROMPT: '你是考试答题助手。根据提供的题目与选项，选出正确答案。' +
        '只输出 JSON，不要任何其他文字，格式：' +
        '{"answers":[{"index":0,"choices":["A"]},{"index":1,"choices":["B","D"]}]}。' +
        '说明：index 为题目数组下标（从0开始）；choices 为选项字母数组，单选题/判断题一个字母，多选题多个字母。' +
        '注意：题干中可能夹杂少量乱码字符，请结合选项语义判断题意。',

    /**
     * 历史版本曾预填 OpenAI 官方默认值；若用户 Key 实际属于中转站/本地服务，
     * 打到官方端点会得到 401。仅做一次性迁移：精确匹配预设时清空，之后由用户自行填写。
     */
    LEGACY_PRESET: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
    },

    _normalizeApiKey: function (key) {
        return String(key || '').trim().replace(/^Bearer\s+/i, '').trim();
    },

    getConfig: function (cb) {
        State.get(m => {
            let baseUrl = (m[KEYS.AI_BASE_URL] || '').trim();
            let model = (m[KEYS.AI_MODEL] || '').trim();
            let apiKey = this._normalizeApiKey(m[KEYS.AI_API_KEY]);
            const cleaned = !!m[KEYS.AI_PRESET_CLEANED];
            if (!cleaned) {
                let dirty = false;
                if (baseUrl === this.LEGACY_PRESET.baseUrl) { baseUrl = ''; dirty = true; }
                if (model === this.LEGACY_PRESET.model) { model = ''; dirty = true; }
                if (dirty || !(KEYS.AI_PRESET_CLEANED in m)) {
                    State.set({
                        [KEYS.AI_BASE_URL]: baseUrl,
                        [KEYS.AI_MODEL]: model,
                        [KEYS.AI_API_KEY]: apiKey,
                        [KEYS.AI_PRESET_CLEANED]: true
                    });
                }
            }
            cb({
                enabled: !!m[KEYS.AI_ENABLED],
                baseUrl,
                apiKey,
                model,
                stealth: !!m[KEYS.STEALTH]
            });
        });
    },

    isDone: function () { return this._done; },
    reset: function () { this._done = false; this._running = false; this._lastResult = null; },

    /** 主流程：提取 → 请求 → 解析 → 点击。自动链路幂等；手动按钮可 force 强制重答 */
    run: async function (opts) {
        const force = !!(opts && opts.force);
        if (this._running) {
            if (force) toast('⏳ AI答题进行中，请稍候...');
            return;
        }
        if (typeof Quiz === 'undefined' || !Quiz.isQuizPage()) {
            if (force) toast('⚠️ 当前页面未检测到题目');
            return;
        }
        if (this._done) {
            if (force) {
                this._done = false; // 手动强制：允许重新作答
            } else {
                this._notifyDone();
                return;
            }
        }

        // 免责协议防御：未同意则弹窗并中止（绕过 UI 的调用路径也会被拦）
        const agreed = await new Promise(r => State.get(m => r(!!m[KEYS.DISCLAIMER_AGREED])));
        if (!agreed) {
            try { window.top.postMessage({ action: 'SHOW_DISCLAIMER' }, '*'); } catch (e) {}
            toast('⚠️ 请先阅读并同意免责声明');
            return;
        }

        const cfg = await new Promise(r => this.getConfig(r));
        if (!cfg.apiKey) {
            toast('⚠️ AI答题：请先在设置中填写 API Key');
            return;
        }
        if (!cfg.baseUrl || !cfg.model) {
            toast('⚠️ AI答题：请先在设置中填写 url 和 模型id');
            return;
        }

        this._running = true;
        try {
            // 视频弹题可能一题一弹：循环提取→作答→提交/继续，直到弹题消失
            const isVideoMode = typeof Quiz !== 'undefined' && Quiz.isVideoQuizPresent && Quiz.isVideoQuizPresent();
            let totalClicked = 0;
            let totalQuestions = 0;
            let lastSubmit = { submitted: false, confirmed: false, continued: false, correct: null };
            const maxRounds = isVideoMode ? 8 : 1;

            for (let round = 0; round < maxRounds; round++) {
                // 本帧可见题目（work 全量；视频弹题仅当前展示的 .tkItem）
                const extracted = Quiz.extract().filter(q => {
                    if (q.kind === 'video') return Quiz.isVideoQuizVisible();
                    return true;
                });
                const todo = extracted.filter(q => !q.answer);
                if (todo.length === 0) {
                    if (round === 0) {
                        this._running = false;
                        this._done = true;
                        // 静默退出曾被误认为"不答题"——必须给出明确原因
                        toast(extracted.length === 0
                            ? '⚠️ 未在本页发现题目'
                            : `ℹ️ 本页 ${extracted.length} 题均已有答案，无需重答（可点立即答题强制重做）`);
                        this._notifyDone(0);
                        return;
                    }
                    break;
                }

                // 批量解密题干+选项（失败样本证实选项文本也会被字体加密，漏解会导致模型无法作答）
                let decResults = null;
                if (typeof Decipher !== 'undefined' && Decipher.available()) {
                    const flat = [];
                    todo.forEach(q => {
                        flat.push(q.title);
                        q.options.forEach(o => flat.push(o));
                    });
                    try { decResults = Decipher.decryptMany(flat); } catch (e) { decResults = null; }
                }
                let k = 0;
                const payload = todo.map((q, i) => {
                    let title = q.title;
                    const options = q.options.slice();
                    if (decResults) {
                        const t = decResults[k++];
                        if (t && t.plain) title = t.plain;
                        for (let j = 0; j < options.length; j++) {
                            const r = decResults[k++];
                            if (r && r.plain) options[j] = r.plain;
                        }
                    } else {
                        title = this.decryptTitle(title);
                    }
                    return { index: i, title, options };
                });

                totalQuestions += payload.length;
                toast(`🤖 AI答题：发送 ${payload.length} 题...`);
                const content = await this.callModel(cfg, payload);
                const answers = this.parseAnswers(content, payload.length);

                if (answers.length === 0) {
                    throw new Error('模型未返回有效 JSON 答案');
                }

                let clicked = 0;
                const applyOne = (item, choices) => {
                    if (!item) return false;
                    if (item.kind === 'video') return this.applyVideoAnswer(item, choices);
                    return item.el ? this.applyAnswer(item.el, choices) : false;
                };
                if (cfg.stealth) {
                    for (const a of answers) {
                        const item = todo[a.index];
                        if (applyOne(item, a.choices)) clicked++;
                        if (answers.indexOf(a) < answers.length - 1) {
                            await this._sleep(this._randDelay(this.STEALTH_PER_QUESTION));
                        }
                    }
                    await this._sleep(this._randDelay(this.STEALTH_BEFORE_SUBMIT));
                } else {
                    answers.forEach(a => {
                        if (applyOne(todo[a.index], a.choices)) clicked++;
                    });
                }

                try {
                    this._appendCache(payload, answers);
                } catch (e) { console.warn('[AI答题] 题库缓存失败:', e); }

                // 模型已返回但选项点不中：停止循环，避免反复请求 AI
                if (isVideoMode && clicked === 0) {
                    this._running = false;
                    this._done = true;
                    this._lastResult = {
                        total: totalQuestions, answered: totalQuestions,
                        clicked: totalClicked, submit: lastSubmit, applyFailed: true
                    };
                    toast('⚠️ 视频弹题：已收到模型答案，但未能选中选项（请手动点选后提交）');
                    this._notifyDone(totalClicked);
                    return;
                }

                if (isVideoMode) {
                    lastSubmit = await this.submitVideoQuiz();
                } else {
                    try {
                        lastSubmit = await this.submitWork();
                    } catch (e) {
                        console.warn('[AI答题] 提交环节异常:', e);
                    }
                }
                totalClicked += clicked;

                // work 页一轮结束；视频弹题等 continue 后看是否还有下一题
                if (!isVideoMode) break;
                await this._sleep(500);
                if (!Quiz.isVideoQuizVisible()) break;
                // 弹题仍在但题干未变且仍无答案：视为提交/继续未生效，停止空转
                if (round > 0 && totalClicked === 0) break;
            }

            this._running = false;
            this._done = true;
            this._lastResult = {
                total: totalQuestions,
                answered: totalQuestions,
                clicked: totalClicked,
                submit: lastSubmit
            };
            if (isVideoMode) {
                const ok = lastSubmit.correct === true;
                const bad = lastSubmit.correct === false;
                toast(ok
                    ? `🤖 视频弹题已作答并继续（${totalClicked} 题）`
                    : bad
                        ? `🤖 视频弹题已提交（答错，页面已回看/继续，${totalClicked} 题）`
                        : `🤖 视频弹题处理完成（${totalClicked} 题）`);
            } else if (lastSubmit.confirmed) {
                toast(`🤖 已答题并提交（${totalClicked} 题）`);
            } else if (lastSubmit.submitted) {
                toast(`🤖 已点击提交（${totalClicked} 题），确认弹窗未出现`);
            } else {
                toast(`🤖 AI答题完成（${totalClicked} 题，本页无提交按钮）`);
            }
            this._notifyDone(totalClicked);
        } catch (e) {
            this._running = false;
            console.error('[AI答题] 失败:', e);
            toast(`❌ AI答题失败: ${e.message || e}`);
            // 失败不置 done：允许重试，也允许流程超时跳过
        }
    },

    /** 题库缓存：按题干 upsert，上限 500 条（防 storage 膨胀） */
    _appendCache: function (payload, answers) {
        const ansByIndex = new Map();
        answers.forEach(a => ansByIndex.set(a.index, a.choices.join('')));
        State.get(m => {
            const list = Array.isArray(m[KEYS.AI_CACHE]) ? m[KEYS.AI_CACHE] : [];
            payload.forEach(p => {
                const key = Utils.normalizeText(p.title);
                if (!key) return;
                const item = {
                    title: p.title,
                    options: (p.options || []).slice(0, 5),
                    answer: ansByIndex.get(p.index) || '',
                    at: Date.now()
                };
                const idx = list.findIndex(x => Utils.normalizeText(x.title) === key);
                if (idx >= 0) list[idx] = item;
                else list.push(item);
            });
            State.set({ [KEYS.AI_CACHE]: list.slice(-500) });
        });
    },

    /** 题干解密（Decipher 模块就绪时启用，否则原文发送） */
    decryptTitle: function (title) {
        if (typeof Decipher !== 'undefined' && Decipher.available()) {
            try {
                const r = Decipher.decrypt(title);
                if (r && r.plain) return r.plain;
            } catch (e) {}
        }
        return title;
    },

    /**
     * 提交试卷：点 a.btnSubmit → 轮询两处确认弹窗：
     *  ① work 帧内 #confirmSubWin（"确认提交？"→ .bluebtn submitCheckTimes）
     *  ② 顶层 #workpop（现场样本：workPop 组件，"确认提交？"→ #popok 触发真正提交回调）
     * 顶层确认是终点；内部确认后若无接力则在短等待后返回。
     */
    submitWork: async function () {
        const btn = document.querySelector('a.btnSubmit, .btnSubmit');
        if (!btn) return { submitted: false, confirmed: false };
        Utils.safeClick(btn);

        const st = { inner: false, top: false };
        let innerAt = 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
            if (!st.inner) {
                const win = document.querySelector('#confirmSubWin');
                if (win && (getComputedStyle(win).display !== 'none' || win.offsetParent !== null)) {
                    const ok = win.querySelector('a.bluebtn[onclick*="submitCheckTimes"], .bluebtn');
                    if (ok) { Utils.safeClick(ok); st.inner = true; innerAt = Date.now(); }
                }
            }
            if (this._clickTopSubmitConfirm()) st.top = true;
            if (st.top) break;
            if (st.inner && Date.now() - innerAt > 4000) break;
            await this._sleep(300);
        }
        return { submitted: true, confirmed: st.inner || st.top };
    },

    /** 顶层（或本帧）"确认提交"弹窗：可见 + 文案匹配才点 #popok，避免误点其它用途 */
    _clickTopSubmitConfirm: function () {
        try {
            const doc = (window.top && window.top.document) ? window.top.document : document;
            const pop = doc.querySelector('#workpop');
            if (!pop) return false;
            if (getComputedStyle(pop).display === 'none') return false;
            const contentEl = pop.querySelector('#popcontent');
            const content = contentEl ? contentEl.innerText : '';
            if (!content.includes('确认提交')) return false;
            const ok = pop.querySelector('#popok');
            if (ok) { Utils.safeClick(ok); return true; }
        } catch (e) { /* 跨域顶层：忽略 */ }
        return false;
    },

    _sleep: (ms) => new Promise(r => setTimeout(r, ms)),

    async _waitFor(fn, timeout, interval) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            try { if (await fn()) return true; } catch (e) {}
            await this._sleep(interval || 300);
        }
        return false;
    },

    /** 调用 OpenAI 兼容接口（30 秒超时，防止 _running 被挂起的请求永久卡死） */
    callModel: async function (cfg, payload) {
        if (!/^https?:\/\//i.test(cfg.baseUrl || '')) {
            throw new Error('AI url 需以 http(s):// 开头，且需与 API Key 所属服务一致');
        }
        const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this._normalizeApiKey(cfg.apiKey)
                },
                signal: ctrl ? ctrl.signal : undefined,
                body: JSON.stringify({
                    model: cfg.model,
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: this.SYSTEM_PROMPT },
                        { role: 'user', content: JSON.stringify(payload) }
                    ]
                })
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('请求超时(30s)');
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 200); } catch (e) {}
            const host = (() => { try { return new URL(url).host; } catch (e) { return url; } })();
            if (res.status === 401 || res.status === 403) {
                throw new Error(`HTTP ${res.status}：${host} 拒绝了 API Key。请检查 url/模型id/Key 是否同一服务（勿把中转站 Key 发到 OpenAI 官方地址）${detail ? ' · ' + detail : ''}`);
            }
            if (res.status === 404) {
                throw new Error(`HTTP 404：${host} 未找到 /chat/completions。请确认 url 是否含正确路径（如中转站需填 …/v1）${detail ? ' · ' + detail : ''}`);
            }
            throw new Error(`HTTP ${res.status} ${detail}`);
        }
        const data = await res.json();
        const content = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('响应缺少 choices[0].message.content');
        return content;
    },

    /** 容错解析：整段 JSON / 夹杂文本中的 JSON 块 */
    parseAnswers: function (content, expectCount) {
        if (!content || typeof content !== 'string') return [];
        let obj = null;
        try { obj = JSON.parse(content.trim()); } catch (e) {}
        if (!obj || typeof obj !== 'object') {
            const m = content.match(/\{[\s\S]*\}/);
            if (m) { try { obj = JSON.parse(m[0]); } catch (e) {} }
        }
        if (!obj || !Array.isArray(obj.answers)) return [];
        return obj.answers
            .filter(a => a && Number.isInteger(a.index) && Array.isArray(a.choices) && a.choices.length > 0)
            .filter(a => a.index >= 0 && a.index < expectCount)
            .map(a => ({ index: a.index, choices: a.choices.map(c => String(c).toUpperCase().trim()) }));
    },

    /** 按答案点击选项：利用页面 toggle 语义，只在状态不一致时点击 */
    applyAnswer: function (qNode, choices) {
        if (!qNode || !choices || choices.length === 0) return false;
        const targets = choices;
        let ops = 0;

        qNode.querySelectorAll('li, .answerBg').forEach(li => {
            const span = li.querySelector('.num_option, .num_option_dx');
            if (!span) return;
            // 字母取 span 显示文本（textContent 对隐藏元素也有效；判断题显示 A/B）
            const letter = (span.textContent || span.getAttribute('data') || '')
                .replace(/[^A-Za-z]/g, '').toUpperCase();
            const labelText = ((li.innerText || '') + ' ' + (li.getAttribute('aria-label') || '')).toUpperCase();
            const checked = span.classList.contains('check_answer') || span.classList.contains('check_answer_dx');
            // 单字母严格匹配字母；多字符（如"对"）允许文本包含匹配
            const should = targets.some(t => t === letter || (t.length > 1 && labelText.includes(t)));
            if (checked !== should) {
                li.click();
                ops++;
            }
        });
        return ops > 0;
    },

    /** 视频弹题选项：li.ans-videoquiz-opt + radio/label，按 A/B/C 或选项文本匹配 */
    applyVideoAnswer: function (item, choices) {
        if (!item || !item.el || !choices || choices.length === 0) return false;
        const lis = [...item.el.querySelectorAll('li.ans-videoquiz-opt, .ans-videoquiz-opt')];
        if (!lis.length) return false;

        // 归一化模型返回：兼容 "B" / "b" / "B、错" / "错"
        const targets = choices.map(c => {
            const raw = String(c || '').trim();
            const upper = raw.toUpperCase();
            const letter = (upper.match(/^[A-Z]/) || [])[0] || '';
            const text = upper.replace(/^[A-Z][\.\s、]*/, '').trim();
            return { raw, upper, letter, text };
        });

        let ops = 0;
        lis.forEach((li, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const text = (li.innerText || '').replace(/\n/g, '').trim().replace(/^[A-Z][\.\s、]*/, '');
            const textUpper = text.toUpperCase();
            const should = targets.some(t =>
                t.letter === letter ||
                (t.text && textUpper.includes(t.text)) ||
                (t.raw && textUpper === t.raw.toUpperCase())
            );
            const input = li.querySelector('input[type=radio], input[type=checkbox]');
            const radioOn = input ? !!input.checked : false;
            const classOn = li.classList.contains('on') || li.classList.contains('checked') ||
                (li.querySelector('.tkRadio') && li.querySelector('.tkRadio').classList.contains('on'));
            if (!should || radioOn || classOn) return;

            // 禁止 safeClick（preventDefault 会拦掉 label→radio 的默认选中）
            const label = li.querySelector('label');
            const radioWrap = li.querySelector('.tkRadio');
            const clickTarget = label || radioWrap || input || li;
            try { clickTarget.click(); } catch (e) {}
            // 兜底：直接勾选 input 并派发事件（ExtJS/自定义组件有时不认 label 默认行为）
            if (input && !input.checked) {
                try {
                    input.checked = true;
                    input.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (e) {}
            }
            if (!input) {
                try { li.click(); } catch (e) {}
            }
            // 确认是否真的选中
            const nowOn = (input && input.checked) ||
                li.classList.contains('on') ||
                (li.querySelector('.tkRadio') && li.querySelector('.tkRadio').classList.contains('on'));
            if (nowOn || !input) ops++;
        });
        return ops > 0;
    },

    /**
     * 视频弹题提交链路（样本：#videoquiz-submit → spanHas/spanNot → #videoquiz-continue）
     * opts.continueOnWrong: 默认 true（AI 主路径答错也点继续，便于回看）；枚举路径传 false
     */
    submitVideoQuiz: async function (opts) {
        opts = opts || {};
        const btns = [...document.querySelectorAll('#videoquiz-submit, a.ans-videoquiz-submit')];
        const submit = btns.find(b =>
            b.id !== 'videoquiz-submitting' &&
            (b.innerText || '').trim() !== '提交中' &&
            (b.offsetParent !== null || getComputedStyle(b).display !== 'none')
        ) || btns.find(b => b.id !== 'videoquiz-submitting');
        if (!submit) return { submitted: false, continued: false, correct: null };
        try { submit.click(); } catch (e) { Utils.safeClick(submit); }

        const t0 = Date.now();
        let correct = null;
        let continued = false;
        while (Date.now() - t0 < 8000) {
            await this._sleep(200);
            const hasEl = document.querySelector('#spanHas, .spanHas');
            const notEl = document.querySelector('#spanNot, #spanNotBack, .spanNot, .spanNotBack');
            const contEl = document.querySelector('#videoquiz-continue, a.ans-videoquiz-continue');
            const hasShown = hasEl && (hasEl.offsetParent !== null || getComputedStyle(hasEl).display !== 'none');
            const notShown = notEl && (notEl.offsetParent !== null || getComputedStyle(notEl).display !== 'none');
            const contShown = contEl && contEl.id !== 'videoquiz-submitting' &&
                (contEl.offsetParent !== null || getComputedStyle(contEl).display !== 'none');
            if (hasShown || notShown || contShown) {
                if (hasShown && !notShown) correct = true;
                else if (notShown) correct = false;
                // 枚举路径：答错不点继续，留在当前题换选项重试
                const shouldContinue = correct !== false || opts.continueOnWrong !== false;
                if (shouldContinue && contEl && (contEl.offsetParent !== null || getComputedStyle(contEl).display !== 'none')) {
                    try { contEl.click(); } catch (e) { Utils.safeClick(contEl); }
                    continued = true;
                } else if (shouldContinue) {
                    await this._sleep(400);
                    const cont2 = document.querySelector('#videoquiz-continue, a.ans-videoquiz-continue');
                    if (cont2 && (cont2.offsetParent !== null || getComputedStyle(cont2).display !== 'none')) {
                        try { cont2.click(); } catch (e) { Utils.safeClick(cont2); }
                        continued = true;
                    }
                }
                break;
            }
        }
        return { submitted: true, continued, correct };
    },

    /** 点选视频弹题某一选项（强制，供枚举使用） */
    _forcePickVideoOption: function (lis, idx) {
        const li = lis[idx];
        if (!li) return false;
        const input = li.querySelector('input[type=radio], input[type=checkbox]');
        const label = li.querySelector('label');
        const radioWrap = li.querySelector('.tkRadio');
        try { (label || radioWrap || input || li).click(); } catch (e) {}
        if (input && !input.checked) {
            try {
                input.checked = true;
                input.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
        }
        return true;
    },

    /**
     * 暴力枚举：随机尝试当前视频弹题所有选项直到答对
     * 返回 { ok, tried, letter, submit }
     */
    enumerateVideoAnswer: async function (item) {
        if (!item || !item.el) return { ok: false, tried: 0 };
        const lis = [...item.el.querySelectorAll('li.ans-videoquiz-opt, .ans-videoquiz-opt')];
        if (!lis.length) return { ok: false, tried: 0 };
        const order = lis.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        let tried = 0;
        let last = { submitted: false, continued: false, correct: null };
        for (const idx of order) {
            tried++;
            const letter = String.fromCharCode(65 + idx);
            this._forcePickVideoOption(lis, idx);
            // 答错后提交按钮可能被隐藏，重试前强制显示
            try {
                const sub = document.querySelector('#videoquiz-submit');
                if (sub) sub.style.display = '';
                ['#spanHas', '#spanNot', '#spanNotBack'].forEach(id => {
                    const el = document.querySelector(id);
                    if (el) el.classList.remove('show');
                });
                const cont = document.querySelector('#videoquiz-continue');
                if (cont) cont.classList.remove('show');
            } catch (e) {}
            await this._sleep(this._randDelay(this.BRUTAL_ENUM_DELAY));
            last = await this.submitVideoQuiz({ continueOnWrong: false });
            if (last.correct === true) {
                // 答对后点继续
                const cont = document.querySelector('#videoquiz-continue, a.ans-videoquiz-continue');
                if (cont && (cont.offsetParent !== null || getComputedStyle(cont).display !== 'none')) {
                    try { cont.click(); } catch (e) {}
                }
                return { ok: true, tried, letter, submit: last };
            }
        }
        return { ok: false, tried, submit: last };
    },

    /**
     * 视频弹题单次作答入口（供 video.js 分支调用）
     * opts.allowEnumerate: 暴力模式下判断/单选可枚举
     * opts.forceAi: 必须走 AI（多选）
     */
    runVideoQuizOnce: async function (opts) {
        opts = opts || {};
        if (typeof Quiz === 'undefined' || !Quiz.isVideoQuizVisible()) {
            return { ok: false, reason: 'no-quiz' };
        }
        const agreed = await new Promise(r => State.get(m => r(!!m[KEYS.DISCLAIMER_AGREED])));
        if (!agreed) return { ok: false, reason: 'disclaimer' };

        const cfg = await new Promise(r => this.getConfig(r));
        const itemNode = Quiz.getVisibleVideoItem();
        const kind = Quiz.getVideoQuizType();

        const enumerate = async () => {
            const node = Quiz.getVisibleVideoItem();
            if (!node) return { ok: false, reason: 'no-item' };
            return this.enumerateVideoAnswer({ el: node });
        };

        // 纯枚举（暴力开 + 未开 AI，或 AI 配置不全但仍可枚举）
        if (opts.allowEnumerate && !cfg.apiKey) {
            return enumerate();
        }

        if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
            if (opts.allowEnumerate) return enumerate();
            return { ok: false, reason: 'config' };
        }

        // 抽题 → 请求模型 → 选中
        const all = Quiz.extract().filter(q => q.kind === 'video' && !q.answer && Quiz.isVideoQuizVisible());
        const todo = all;
        if (!todo.length) {
            if (opts.allowEnumerate) return enumerate();
            return { ok: false, reason: 'no-question' };
        }

        let decResults = null;
        if (typeof Decipher !== 'undefined' && Decipher.available()) {
            const flat = [];
            todo.forEach(q => { flat.push(q.title); q.options.forEach(o => flat.push(o)); });
            try { decResults = Decipher.decryptMany(flat); } catch (e) { decResults = null; }
        }
        let k = 0;
        const payload = todo.map((q, i) => {
            let title = q.title;
            const options = q.options.slice();
            if (decResults) {
                const t = decResults[k++];
                if (t && t.plain) title = t.plain;
                for (let j = 0; j < options.length; j++) {
                    const r = decResults[k++];
                    if (r && r.plain) options[j] = r.plain;
                }
            } else {
                title = this.decryptTitle(title);
            }
            return { index: i, title, options };
        });

        toast(`🤖 视频弹题：发送 ${payload.length} 题...`);
        let content;
        try {
            content = await this.callModel(cfg, payload);
        } catch (e) {
            if (opts.allowEnumerate) return enumerate();
            return { ok: false, reason: 'api', error: e };
        }
        const answers = this.parseAnswers(content, payload.length);
        if (!answers.length) {
            if (opts.allowEnumerate) return enumerate();
            return { ok: false, reason: 'parse' };
        }

        let clicked = 0;
        answers.forEach(a => {
            const item = todo[a.index];
            if (!item) return;
            if (item.kind === 'video') {
                if (this.applyVideoAnswer(item, a.choices)) clicked++;
            }
        });

        if (clicked === 0) {
            if (opts.allowEnumerate) return enumerate();
            return { ok: false, reason: 'apply' };
        }

        // 提交：AI 主路径答错也不自动枚举（暴力关时由调用方跳下一节）
        const submit = await this.submitVideoQuiz({ continueOnWrong: false });
        if (submit.correct === true) {
            const cont = document.querySelector('#videoquiz-continue, a.ans-videoquiz-continue');
            if (cont && (cont.offsetParent !== null || getComputedStyle(cont).display !== 'none')) {
                try { cont.click(); } catch (e) {}
            }
            this._done = true;
            try { State.set({ [KEYS.QUIZ_DONE_FLAG]: true }); } catch (e) {}
            return { ok: true, submit, via: 'ai' };
        }
        // AI 答错/未确认：暴力开且判断/单选 → 再枚举；否则失败
        if (opts.allowEnumerate && kind !== 'multi') {
            return enumerate();
        }
        return { ok: false, submit, reason: 'wrong' };
    },

    /** 完成通知：写持久标志（提交导航后消息/内存状态会丢，storage 不丢）+ 回给父帧 */
    _notifyDone: function (clicked) {
        try {
            State.set({ [KEYS.QUIZ_DONE_FLAG]: true });
        } catch (e) {}
        try {
            window.parent.postMessage({ action: 'QUIZ_DONE', answered: clicked || 0 }, '*');
        } catch (e) {}
    }
};

// main.js - 核心大脑与调度中心（刷课专精版）

// ==========================================
// 1. 顶层全局监听器与提示 UI
// ==========================================
if (window.self === window.top) {
    window.addEventListener('message', (e) => {
        if (e.data && e.data.action === 'SHOW_TOAST') {
            let toast = document.getElementById('cx-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'cx-toast';
                toast.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 24px;border-radius:8px;z-index:999999999;font-size:14px;pointer-events:none;font-weight:bold;transition:opacity 0.3s;box-shadow:0 4px 10px rgba(0,0,0,0.3);';
                document.body.appendChild(toast);
            }
            toast.innerText = e.data.msg;
            toast.style.display = 'block';
            toast.style.opacity = '1';
            setTimeout(() => { if(toast.innerText === e.data.msg) toast.style.opacity = '0'; }, 3000);
        }

        if (e.data && e.data.action === 'SHOW_DISCLAIMER') {
            if (typeof UI !== 'undefined' && UI.showDisclaimer) UI.showDisclaimer();
        }

        if (e.data && e.data.action === 'VIDEO_PROGRESS') {
            // 仅刷课运行中展示进度（防止停止后残留的进度消息重新点亮胶囊）
            State.get(m => {
                if (typeof UI === 'undefined' || !UI.setCapsuleProgress) return;
                if (m[KEYS.IS_LEARN_RUNNING]) {
                    UI.setCapsuleProgress(e.data.pct, {
                        stealthOn: !!e.data.stealthOn,
                        blurred: !!e.data.blurred,
                        blurRemain: e.data.blurRemain || 0
                    });
                } else {
                    UI.hideCapsule();
                }
            });
        }

        if (e.data && e.data.action === 'FORCE_ENTRY_JUMP') {
            // 连续跳过多个空章节后，强制重新定位未完成章节（一步到位）
            if (window.self === window.top && typeof EntryJump !== 'undefined') {
                EntryJump._done = false;
                EntryJump.run();
            }
        }

        if (e.data && e.data.action === 'NEXT_CHAPTER') {
            // 注：旧版曾注入内联 script 覆盖 confirm/alert，学习通页面 CSP 禁止内联脚本，
            // 且弹窗已由 PopupBreaker 统一处理——该注入已移除（会触发 CSP 报错）。

            // 可见优先：新版顶层存在文档序更靠前但 display:none 的 .nextChapter，点隐藏元素不可靠
            let nextBtn = null;
            for (const sel of ['.prev_next.next', '#prevNextFocusNext', '.nextChapter']) {
                for (const el of document.querySelectorAll(sel)) {
                    if (el.offsetParent !== null && getComputedStyle(el).display !== 'none') {
                        nextBtn = el; break;
                    }
                }
                if (nextBtn) break;
            }
            if (!nextBtn) {
                const elements = document.querySelectorAll('span, a, div');
                for (let el of elements) {
                    if (el.innerText && el.innerText.trim() === '下一节' && el.offsetParent !== null) {
                        nextBtn = el; break;
                    }
                }
            }

            if (nextBtn) {
                Utils.safeClick(nextBtn);
                // 拦截弹窗统一由 PopupBreaker 全局巡检负责强穿
            } else {
                let toastEl = document.getElementById('cx-toast');
                if (toastEl) {
                    toastEl.innerText = "🛑 未找到下一节按钮，这可能是最后一章了！";
                    toastEl.style.opacity = '1';
                }
                if(typeof State !== 'undefined') State.set({ [KEYS.IS_LEARN_RUNNING]: false });
            }
        }
    });
}

function toast(msg) {
    window.top.postMessage({ action: "SHOW_TOAST", msg: msg }, '*');
}

// ==========================================
// 1.5 启动入口定位：读右侧目录状态，直接跳到未完成章节
//     数据源：#coursetree 内 _studystate = {nextChapterId:..., unfinishCount:...}
//     跳转方式：点击目标目录项的 .posCatalog_name（其内联 onclick 在页面 world 执行）
// ==========================================
const EntryJump = {
    _done: false, // 每个页面文档只定位一次（章节切换可能不刷新文档）

    /**
     * @returns {'ok'|'jumped'|'stopped'} ok=可正常开始; jumped=已触发跳转(本周期不启动); stopped=全部完成已停
     */
    run: function () {
        if (window.self !== window.top) return 'ok';
        if (this._done) return 'ok';

        const stateEl = document.querySelector('#_studystate');
        if (!stateEl || !stateEl.value) { this._done = true; return 'ok'; } // 无目录结构：不拦截

        const nextM = stateEl.value.match(/nextChapterId\s*:\s*(\d+)/);
        const unfinM = stateEl.value.match(/unfinishCount\s*:\s*(\d+)/);
        if (!nextM) { this._done = true; return 'ok'; }
        const nextId = nextM[1];
        const unfinish = unfinM ? parseInt(unfinM[1], 10) : -1;

        // 全部完成
        if (unfinish === 0) {
            this._done = true;
            toast('✅ 所有章节均已完成，无需刷课');
            State.set({ [KEYS.IS_LEARN_RUNNING]: false });
            return 'stopped';
        }

        // 当前章节：URL chapterId 优先，目录 active 项备选
        const curId = this._currentChapterId();
        if (curId && curId === nextId) {
            this._done = true; // 已在目标章节，正常开始
            return 'ok';
        }

        // 执行跳转（本页只跳一次）
        this._done = true;
        const target = document.querySelector(`#cur${nextId} .posCatalog_name`) ||
            document.querySelector(`[id="${nextId}"] .posCatalog_name`) ||
            this._findFirstUnfinished();
        if (target) {
            toast(unfinish > 0
                ? `📍 检测到 ${unfinish} 个未完成任务点，跳转目标章节...`
                : '📍 跳转未完成章节...');
            Utils.safeClick(target);
            return 'jumped';
        }
        return 'ok'; // 找不到目录项：不拦截，走原流程
    },

    _currentChapterId: function () {
        try {
            const q = new URLSearchParams(location.search).get('chapterId');
            if (q) return q;
        } catch (e) {}
        const active = document.querySelector('#coursetree .posCatalog_active');
        if (active) {
            const id = active.id || '';
            return id.startsWith('cur') ? id.slice(3) : id;
        }
        return null;
    },

    /** 备用：第一个没有"已完成"标记的叶子章节 */
    _findFirstUnfinished: function () {
        const items = document.querySelectorAll('#coursetree .posCatalog_select');
        for (const it of items) {
            if (it.classList.contains('firstLayer')) continue;
            if (it.querySelector('.icon_Completed')) continue;
            const name = it.querySelector('.posCatalog_name');
            if (name) return name;
        }
        return null;
    }
};

// ==========================================
// 2. 拦截弹窗全局巡检器 (PopupBreaker)
//    只要刷课在运行，持续识别并点掉各类拦截弹窗，
//    不再依赖"点击下一节后10秒窗口"，解决晚出现的弹窗卡死。
// ==========================================
const PopupBreaker = {
    // 弹窗处理规则：selectors 按优先级，点击第一个可见命中
    rules: [
        // 新版任务未完成确认（mask 版优先：closeDeleteWindow 不依赖外部 WAY 脚本）
        { id: 'job-tip', selectors: ['.jobFinishTip a.nextChapter', '#jobFinishTip .nextChapter', '.layui-layer-btn0'] },
        // 新版章节笔记未保存（PCount.next 在此 return，点掉后需重触发跳转）
        { id: 'save-tips', selectors: ['#saveTips a.popMoveDele', '#saveTips .popMoveDele'], retryNext: true },
        // 冻结/限制页
        { id: 'freeze', selectors: ['#freezePage .keepLearning', '#freezePage2 .jb_btn', '.bluebtn'] },
        // 每日任务上限提示（点"知道了"解除遮罩）
        { id: 'limit', selectors: ['.jobCountDiv a.jb_btn'] }
    ],

    isVisible: (el) => {
        if (!el) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    },

    sweep: function () {
        if (typeof State === 'undefined') return;
        State.get((memory) => {
            if (!memory[KEYS.IS_LEARN_RUNNING]) return;

            // 验证码类弹窗需要人工处理，只提示不硬点
            const verifyTip = document.querySelector('#chapterVerificationCodeTip, #chapterVerificationCode');
            if (verifyTip && this.isVisible(verifyTip)) {
                toast("⚠️ 出现验证码弹窗，请手动完成验证码！");
                return;
            }

            // 顶层"确认提交"弹窗（AI 提交链路残留兜底，防止遮罩挡住"下一节"）
            const workPop = document.querySelector('#workpop');
            if (workPop && this.isVisible(workPop)) {
                const contentEl = workPop.querySelector('#popcontent');
                const content = contentEl ? contentEl.innerText : '';
                if (content.includes('确认提交')) {
                    const ok = workPop.querySelector('#popok');
                    if (ok && this.isVisible(ok)) {
                        console.log('💥 [弹窗巡检] 点击顶层提交确认 #popok');
                        Utils.safeClick(ok);
                        return;
                    }
                }
            }

            for (const rule of this.rules) {
                for (const sel of rule.selectors) {
                    const el = document.querySelector(sel);
                    if (this.isVisible(el)) {
                        console.log(`💥 [弹窗巡检] 命中规则 ${rule.id}，点击: ${sel}`);
                        Utils.safeClick(el);
                        if (rule.retryNext) {
                            PopupBreaker.scheduleRetrigger();
                        }
                        return;
                    }
                }
            }
        });
    },

    // 笔记弹窗关闭后 PCount.next 已被截断，延迟重新触发跳下一节（限次防死循环）
    retryCount: 0,
    scheduleRetrigger: function () {
        if (this.retryCount >= 3) return;
        this.retryCount++;
        setTimeout(() => {
            if (typeof State === 'undefined') return;
            State.get((m) => {
                if (m[KEYS.IS_LEARN_RUNNING]) {
                    window.top.postMessage({ action: "NEXT_CHAPTER" }, '*');
                }
            });
        }, 1200);
    }
};

// 刷课运行期间每 1.2 秒巡检一次
setInterval(() => { try { PopupBreaker.sweep(); } catch (e) {} }, 1200);

// ==========================================
// 3. 刷课任务调度器 (TaskManager)
// ==========================================
const TaskManager = {
    isRunning: false,
    tasks: [],
    currentIndex: 0,
    globalDonePct: 90,
    globalRndDone: false,
    globalRndBlur: false,
    stealth: false,
    // 超强隐藏模式的随机延迟区间（毫秒），测试可压缩
    STEALTH_START_DELAY: [3000, 10000],   // 起步扫描延迟（叠加在基础 2.5s 上）
    STEALTH_SWITCH_DELAY: [2000, 10000],  // 跳下一节随机延迟
    _beatTimer: null,
    _myTabId: null,
    hasUnfinishedQuiz: false,
    quizWaitTimeout: 90000,
    quizPoll: null,
    _nextPending: false,

    // 启动入口定位：连续跳过 N 个空/已完成章节后强制重新定位
    EMPTY_STREAK_JUMP: 6,

    start: function(donePct, rndDone, rndBlur, stealth) {
        this.isRunning = true;
        const pct = parseInt(donePct, 10);
        this.globalDonePct = (pct >= 10 && pct <= 100) ? pct : 90;
        this.globalRndDone = !!rndDone;
        this.globalRndBlur = !!rndBlur;
        this.stealth = !!stealth;
        this.hasUnfinishedQuiz = false;
        this._nextPending = false;
        if (this.quizPoll) { clearInterval(this.quizPoll); this.quizPoll = null; }
        // 新章节开始：清掉上一章遗留的"测验已完成"标志
        try { State.set({ [KEYS.QUIZ_DONE_FLAG]: false }); } catch (e) {}
        toast(this.stealth ? "🧠 超强隐藏模式已启动（行为随机化）..." : "🧠 启动刷课，正在解析源码锁定任务...");

        // 起步随机延迟（仅超强模式）：避免秒扫秒动的启动特征
        this._startScanTimer = setTimeout(() => this.scanTasks(), this._calcStartDelay());

        // 超强模式：防多开心跳
        if (this.stealth) this._startBeat();
        else this._stopBeat();
    },

    /** 起步扫描延迟：普通 2500ms；超强模式叠加 3~10s 随机 */
    _calcStartDelay: function () {
        let d = 2500;
        if (this.stealth) {
            const [a, b] = this.STEALTH_START_DELAY;
            d += a + Math.floor(Math.random() * (b - a + 1));
        }
        return d;
    },

    /** ---- 防多开锁：同浏览器多标签并发是最致命的人为异常 ---- */
    _startBeat: function () {
        this._stopBeat();
        try {
            if (!sessionStorage.getItem('cx_tab_id')) {
                sessionStorage.setItem('cx_tab_id', 'tab_' + Math.random().toString(36).slice(2, 10));
            }
            this._myTabId = sessionStorage.getItem('cx_tab_id');
        } catch (e) { this._myTabId = 'tab_' + Math.random().toString(36).slice(2, 10); }

        const beat = () => {
            if (!this.isRunning || !this.stealth) return;
            try {
                State.get(m => {
                    const now = Date.now();
                    const other = m.cx_beat;
                    if (other && other.id !== this._myTabId && now - other.t < 15000) {
                        State.set({ [KEYS.IS_LEARN_RUNNING]: false });
                        this.stop();
                        this._stopBeat();
                        // 放在 stop 之后，确保提示不被覆盖
                        toast('🛑 检测到其它窗口也在刷课，已自动停止（防多开锁）');
                        return;
                    }
                    State.set({ cx_beat: { id: this._myTabId, t: now } });
                });
            } catch (e) {}
        };
        beat();
        this._beatTimer = setInterval(beat, 10000);
    },

    _stopBeat: function () {
        if (this._beatTimer) { clearInterval(this._beatTimer); this._beatTimer = null; }
    },

    stop: function() {
        this.isRunning = false;
        toast("🛑 已停止自动刷课");
    },

    scanTasks: function() {
        if (!this.isRunning) return;
        this.tasks = [];
        this.hasUnfinishedQuiz = false;
        this._nextPending = false;
        if (this.quizPoll) { clearInterval(this.quizPoll); this.quizPoll = null; }

        let unfinishedJobIds = [];
        let mArgObj = null;

        const scripts = document.querySelectorAll('script');
        for (let s of scripts) {
            let text = s.textContent;
            if (!text || !text.includes('mArg')) continue;

            let match = text.match(/try\s*\{\s*mArg\s*=\s*(\{[\s\S]+?\});\s*\}\s*catch/);
            if (!match) match = text.match(/mArg\s*=\s*(\{[\s\S]+?\});/);

            if (match) {
                try {
                    mArgObj = JSON.parse(match[1]);
                    break;
                } catch(e) {}
            }
        }

        if (mArgObj && mArgObj.attachments) {
            mArgObj.attachments.forEach(att => {
                if (att.job === true && !att.isPassed) {
                    let jid = (att.property && att.property.jobid) ? att.property.jobid : att.jobid;
                    if (jid) unfinishedJobIds.push(String(jid));
                }
            });
        }

        // 任务点分类：视频 / 文档 / 测验（测验不执行，仅记录并跳过）
        const quizJobIds = [];
        if (mArgObj && mArgObj.attachments) {
            mArgObj.attachments.forEach(att => {
                const t = String(att.type || (att.property && att.property.type) || '').toLowerCase();
                const mod = String((att.property && att.property.module) || '').toLowerCase();
                const isQuiz = t === 'workid' || t === 'work' || t === 'exam' || t === 'quiz' || mod === 'work';
                if (isQuiz) {
                    const jid = (att.property && att.property.jobid) || att.jobid;
                    if (jid) quizJobIds.push(String(jid));
                    if (att.job === true && !att.isPassed) {
                        this.hasUnfinishedQuiz = true;
                        toast("📝 本页含章节测验（AI答题开启时自动作答，否则跳过）");
                    }
                }
            });
        }

        // 旧版：.ans-cc 容器 + iframe[module]；新版：任务移入卡片帧，iframe 改用 class/jobid 标识
        const iframes = document.querySelectorAll('.ans-cc iframe, iframe[module], iframe.ans-attach-online, iframe[jobid]');

        iframes.forEach((iframe) => {
            const dataStr = iframe.getAttribute('data') || "";
            const cleanDataStr = dataStr.replace(/&quot;/g, '"');
            const moduleName = iframe.getAttribute('module') || "";
            const src = iframe.src || "";
            const className = String(iframe.getAttribute('class') || "");

            // 任务类型识别：旧版靠 module/data/src 含 "video"；新版靠 class(ans-insertvideo) 或 data 扩展名
            let taskType = 'other';
            const isVideo =
                moduleName.includes('video') ||
                className.includes('insertvideo') ||
                /["']type["']\s*:\s*["']\.(mp4|m4v|flv|avi|mkv|m3u8)/i.test(cleanDataStr) ||
                /\.(mp4|m4v|flv|avi|mkv|m3u8)["']/i.test(cleanDataStr) ||
                cleanDataStr.includes('insertvideo') ||
                src.toLowerCase().includes('video');
            const isDoc =
                moduleName.includes('doc') || moduleName.includes('pdf') || moduleName.includes('ppt') ||
                className.includes('insertdoc') || className.includes('insertppt') ||
                className.includes('insertpdf') || className.includes('insertimage') ||
                /["']type["']\s*:\s*["']\.(pptx?|docx?|pdf|xlsx?)/i.test(cleanDataStr) ||
                /\.(pptx?|docx?|pdf|xlsx?)["']/i.test(cleanDataStr) ||
                cleanDataStr.includes('insertdoc') || cleanDataStr.includes('insertppt') ||
                /doc|pdf|ppt/.test(src.toLowerCase());
            const isQuizIframe =
                className.includes('insertwork') || className.includes('ans-insertwork') ||
                moduleName.includes('work') || cleanDataStr.includes('insertwork');
            if (isVideo) taskType = 'video';
            else if (isDoc) taskType = 'doc';
            else if (isQuizIframe) taskType = 'quiz';

            let currentJobId = null;
            try {
                let dataObj = JSON.parse(cleanDataStr);
                let j = dataObj.jobid || dataObj.jobId || dataObj._jobid;
                if (j) currentJobId = String(j);
            } catch(e) {
                let match = cleanDataStr.match(/"_?job[iI]d"\s*:\s*"([^"]+)"/);
                if (match && match[1]) currentJobId = String(match[1]);
            }
            // 新版任务 iframe 直接携带 jobid 属性
            if (!currentJobId) {
                const attrJobId = iframe.getAttribute('jobid') || iframe.getAttribute('_jobid');
                if (attrJobId) currentJobId = String(attrJobId);
            }

            // 测验 iframe 不入队执行
            if (taskType === 'quiz' || quizJobIds.includes(String(currentJobId || ''))) {
                if (mArgObj) {
                    if (currentJobId && unfinishedJobIds.includes(currentJobId)) this.hasUnfinishedQuiz = true;
                } else if (currentJobId) {
                    this.hasUnfinishedQuiz = true;
                }
                return;
            }

            let isUnfinished = false;
            if (mArgObj) {
                isUnfinished = currentJobId && unfinishedJobIds.includes(currentJobId);
            } else {
                isUnfinished = !!currentJobId;
            }

            if (taskType !== 'other' && isUnfinished) {
                if (!this.tasks.find(t => t.iframe === iframe)) {
                    this.tasks.push({ type: taskType, iframe: iframe, isJob: true });
                }
            }
        });

        if (this.tasks.length > 0) {
            // 有实际任务：清零连续空章计数
            try { State.set({ cx_empty_streak: 0 }); } catch (e) {}
            toast(`📋 破壳成功！抓出 ${this.tasks.length} 个未完成任务！准备执行...`);
            this.currentIndex = 0;
            this.runNext();
        } else {
            toast("🈳 本页视频和PPT已处理，准备跳下一节...");
            this._bumpEmptyStreak();
            this.requestNextChapter();
        }
    },

    /**
     * 连续空章计数（storage 持久，跨 AJAX 换章/整页刷新）：
     * 达到 EMPTY_STREAK_JUMP 时通知顶层强制重新定位到未完成章节
     */
    _bumpEmptyStreak: function () {
        State.get(m => {
            const n = (m.cx_empty_streak || 0) + 1;
            if (n >= this.EMPTY_STREAK_JUMP) {
                State.set({ cx_empty_streak: 0 });
                console.log(`[入口定位] 连续 ${this.EMPTY_STREAK_JUMP} 个空章节，强制重新定位`);
                window.top.postMessage({ action: 'FORCE_ENTRY_JUMP' }, '*');
            } else {
                State.set({ cx_empty_streak: n });
            }
        });
    },

    // 跳下一节：AI 关闭时与原逻辑一致直接跳；开启且有未完成测验时等待答题完成
    requestNextChapter: function() {
        // 纵深防御：测验帧不发起跳转（防止误判引发的提前 NEXT_CHAPTER）
        if (typeof Quiz !== 'undefined' && Quiz.isQuizPage()) return;
        if (this._nextPending) return;
        this._nextPending = true;
        State.get(m => {
            const aiOn = !!m[KEYS.AI_ENABLED];
            if (aiOn && this.hasUnfinishedQuiz) {
                // 答题可能早于等待窗口完成（消息已丢）→ 持久标志直接放行
                if (m[KEYS.QUIZ_DONE_FLAG]) {
                    toast("✅ 测验已完成（含提交），进入下一节...");
                    this._postNextChapter();
                    return;
                }
                toast("🧠 AI 答题中，等待完成后再跳过（最多 " + Math.round(this.quizWaitTimeout / 1000) + " 秒）...");
                // 主动向子帧发 QUIZ_START（查询+触发；已完成的帧会立即回 QUIZ_DONE）
                const fire = () => {
                    document.querySelectorAll('iframe').forEach(f => {
                        try { f.contentWindow.postMessage({ action: 'QUIZ_START' }, '*'); } catch (e) {}
                    });
                };
                fire();
                let waited = 0;
                this.quizPoll = setInterval(() => {
                    waited += 3000;
                    if (waited % 9000 === 0) fire(); // 每 9 秒重发，兜底 iframe 晚就绪
                    // 每周期检查持久完成标志（消息通道丢失时的兜底）
                    State.get(mm => {
                        if (mm[KEYS.QUIZ_DONE_FLAG] && this._nextPending) {
                            toast("✅ AI答题完成（含提交），进入下一节...");
                            this._postNextChapter();
                            return;
                        }
                        if (waited >= this.quizWaitTimeout) {
                            toast("⏳ AI答题等待超时，强制跳过");
                            this._postNextChapter();
                        }
                    });
                }, 3000);
            } else {
                // 原逻辑节奏（扫描空/完成后的短延迟）
                setTimeout(() => this._postNextChapter(), 2500);
            }
        });
    },

    _postNextChapter: function() {
        if (typeof Quiz !== 'undefined' && Quiz.isQuizPage()) return; // 测验帧不发跳转
        if (this.quizPoll) { clearInterval(this.quizPoll); this.quizPoll = null; }
        this._nextPending = false;
        // 超强隐藏模式：章节切换随机延迟（消除固定节拍）
        if (this.stealth) {
            const [a, b] = this.STEALTH_SWITCH_DELAY;
            const delay = a + Math.floor(Math.random() * (b - a + 1));
            setTimeout(() => window.top.postMessage({ action: "NEXT_CHAPTER" }, '*'), delay);
            return;
        }
        window.top.postMessage({ action: "NEXT_CHAPTER" }, '*');
    },

    onQuizDone: function(data) {
        // 无论等待窗口是否已建立，先落持久标志（早到的消息也不丢）
        try { State.set({ [KEYS.QUIZ_DONE_FLAG]: true }); } catch (e) {}
        if (!this._nextPending) return; // 尚未进入等待：由 requestNextChapter 的标志检查接住
        toast(`✅ AI答题完成，2秒后进入下一节...`);
        // 延迟跳转：给提交表单导航与卡片状态刷新留出时间（避免撞"未完成"弹窗）
        setTimeout(() => this._postNextChapter(), 2000);
    },

    runNext: function() {
        if (!this.isRunning) return;

        if (this.currentIndex >= this.tasks.length) {
            toast("🎉 本页视频和PPT已全部搞定！准备跳下一节...");
            this.requestNextChapter();
            return;
        }

        const currentTask = this.tasks[this.currentIndex];
        const typeName = currentTask.type === 'video' ? '视频' : '文档/PPT';
        toast(`🚀 正在冲锋：第 ${this.currentIndex + 1} 个任务 (${typeName})...`);

        const actionCommand = currentTask.type === 'video' ? 'START_VIDEO' : 'START_DOC';

        setTimeout(() => {
            if (this.isRunning) {
                currentTask.iframe.contentWindow.postMessage({
                    action: actionCommand,
                    donePct: this.globalDonePct,
                    rndDone: this.globalRndDone,
                    rndBlur: this.globalRndBlur,
                    stealth: this.stealth
                }, '*');
            }
        }, 1000);
    }
};

window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'TASK_FINISHED') {
        const typeName = event.data.type === 'video' ? '视频' : '文档/PPT';
        toast(`✅ ${typeName} 任务完毕！2秒后开启下一个...`);
        // 顶层：视频完成时胶囊切换为完成态
        if (event.data.type === 'video' && window.self === window.top &&
            typeof UI !== 'undefined' && UI.capsuleDone) {
            UI.capsuleDone();
        }
        TaskManager.currentIndex++;

        if (TaskManager.isRunning) {
            setTimeout(() => TaskManager.runNext(), 2000);
        }
    }
});

// ==========================================
// 3.5 AI 测验答题消息路由（所有帧都参与）
//     QUIZ_START：逐层转发到含题目的帧并触发答题（幂等）
//     QUIZ_DONE ：卡片帧收到后驱动"跳下一节"
// ==========================================
window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.action === 'QUIZ_START') {
        if (typeof Quiz !== 'undefined' && Quiz.isQuizPage()) {
            if (typeof AIBrain !== 'undefined') AIBrain.run();
        } else {
            document.querySelectorAll('iframe').forEach(f => {
                try { f.contentWindow.postMessage({ action: 'QUIZ_START' }, '*'); } catch (e) {}
            });
        }
    }

    if (event.data.action === 'QUIZ_DONE') {
        if (typeof TaskManager !== 'undefined') TaskManager.onQuizDone(event.data);
    }
});

// ==========================================
// 4. 全局核心大循环（刷课）
// ==========================================
(function() {
    try {
        if (window.self === window.top) {
            if(typeof UI !== 'undefined' && UI.inject) UI.inject();
        }
    } catch (e) {}

    // 平台分发：智慧树走独立适配器，学习通走原有逻辑
    const platform = typeof Platform !== 'undefined' ? Platform.current() : null;

    setInterval(() => {
        if (typeof State === 'undefined') return;

        // 顶层周期性刷新面板状态（通用）
        if (window.self === window.top && typeof UI !== 'undefined' && document.getElementById('cx-dashboard')) {
            try { UI.updateState(); } catch (e) {}
        }

        State.get((memory) => {
            // ---- 智慧树平台：独立主循环 ----
            if (platform === 'zhihuishu') {
                if (!memory[KEYS.IS_LEARN_MODE] || !memory[KEYS.IS_LEARN_RUNNING]) {
                    if (typeof Zhs !== 'undefined') Zhs.stop();
                    return;
                }
                if (!memory[KEYS.DISCLAIMER_AGREED]) {
                    if (window.self === window.top && typeof UI !== 'undefined' && UI.showDisclaimer) {
                        UI.showDisclaimer();
                    }
                    State.set({ [KEYS.IS_LEARN_RUNNING]: false });
                    return;
                }
                if (typeof Zhs !== 'undefined') Zhs.tick(memory);
                return;
            }

            // ---- 学习通平台（原有逻辑）----
            if (memory[KEYS.IS_LEARN_MODE]) {
                if (memory[KEYS.IS_LEARN_RUNNING]) {
                    // 防御：未同意免责声明不得启动刷课
                    if (!memory[KEYS.DISCLAIMER_AGREED]) {
                        if (window.self === window.top && typeof UI !== 'undefined' && UI.showDisclaimer) {
                            UI.showDisclaimer();
                        }
                        State.set({ [KEYS.IS_LEARN_RUNNING]: false });
                        return;
                    }
                    // 顶层：启动入口定位——直接跳到未完成章节（jumped/stopped 本周期不启动）
                    if (window.self === window.top && typeof EntryJump !== 'undefined') {
                        const entry = EntryJump.run();
                        if (entry !== 'ok') return;
                    }
                    // 课程内容帧：旧版在顶层，新版在卡片帧（.ans-cc / .ans-attach-ct）
                    // 排除测验帧：work.html 内含 ZyBottom.ans-cc，但它是答题页不是课程内容帧，
                    // 否则其空扫描会误发 NEXT_CHAPTER 把刚开始的答题跳走
                    const isQuizFrame = typeof Quiz !== 'undefined' && Quiz.isQuizPage();
                    const isCourseFrame = !isQuizFrame &&
                        document.querySelector('.ans-cc, .ans-attach-ct') !== null;
                    if (isCourseFrame && !TaskManager.isRunning) {
                        TaskManager.start(memory[KEYS.VIDEO_DONE_PCT], memory[KEYS.RND_DONE],
                            memory[KEYS.RND_BLUR], memory[KEYS.STEALTH]);
                    }
                    // AI 自动答题：测验帧在开关开启时自动执行（QUIZ_START 手动触发不受此限制）
                    if (memory[KEYS.AI_ENABLED] && memory[KEYS.DISCLAIMER_AGREED] &&
                        typeof Quiz !== 'undefined' && Quiz.isQuizPage() &&
                        typeof AIBrain !== 'undefined' && !AIBrain.isDone()) {
                        AIBrain.run();
                    }
                } else {
                    if (TaskManager.isRunning) TaskManager.stop();
                }
            }
        });
    }, 2000);
})();

// video.js - 视频任务模块（原速静音 + 进度阈值 + 防风控随机行为）
// 注意：不修改 playbackRate（倍速已被服务端风控），仅原速播放
console.log("🎬 视频模块已挂载");

const VideoWorker = {
    isFinished: false,
    targetDonePct: 90,
    rndDone: false,
    rndBlur: false,
    stealth: false,
    _currentThreshold: 90,
    _keepAlive: null,
    // 达标后随机延迟完成（超强模式）
    _finishPending: false,
    _finishTimer: null,
    // 随机失焦状态
    _blurred: false,
    _blurPaused: false,
    _blurTimer: null,
    _refocusTimer: null,
    _refocusAt: null, // 恢复时间戳（兜底：定时器丢失/节流时由巡检补触发）
    // 随机延迟区间（测试可压缩）
    STEALTH_FINISH_DELAY: [2000, 15000],
    // 失焦触发参数：每视频 60% 概率（整体期望间隔≈15 分钟）、进度 25%~75% 随机位置
    BLUR_TRIGGER_CHANCE: 0.6,
    BLUR_POS_RANGE: [0.25, 0.75],
    BLUR_MIN_VIDEO: 240, // 视频短于此秒数不调度失焦
    _blurScheduledFor: null, // 已为当前视频调度失焦的标记
    // 视频弹题：展示期间暂停播放，且不被防暂停逻辑抢播
    _quizBlocked: false,
    _quizAiTried: false,
    _quizSkipDone: false,

    /** 指数分布随机数：均值 mean，天然"越长概率越小" */
    _expRandom: function (mean) {
        return Math.max(1, Math.round(-Math.log(1 - Math.random()) * mean));
    },

    _randDelay: function (range) {
        const [a, b] = range;
        return a + Math.floor(Math.random() * (b - a + 1));
    },

    /** 视频内弹题是否正展示（ans-videoquiz overlay） */
    _quizVisible: function () {
        if (typeof Quiz !== 'undefined' && Quiz.isVideoQuizVisible) return Quiz.isVideoQuizVisible();
        const el = document.querySelector('.ans-videoquiz');
        if (!el) return false;
        try {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
        } catch (e) {
            return el.offsetHeight > 0;
        }
    },

    /**
     * 弹题巡检：展示则暂停视频；AI 开启时自动作答，答完/继续后恢复播放。
     * 返回 true 表示当前被弹题占用。
     */
    _checkVideoQuiz: function () {
        if (this.isFinished) return false;
        const shown = this._quizVisible();
        if (!shown) {
            if (this._quizBlocked) {
                this._quizBlocked = false;
                this._quizAiTried = false;
                this._quizSkipDone = false;
            }
            return false;
        }
        this._quizBlocked = true;
        const video = document.querySelector('video') || document.querySelector('.vjs-tech');
        if (video && !video.paused && !video.ended) {
            try { video.pause(); } catch (e) {}
        }

        // 视频弹题分支：暴力/AI/直接跳下一节（只触发一次，避免反复发题）
        if (!this._quizAiTried && typeof AIBrain !== 'undefined') {
            State.get(m => {
                const aiOn = !!m[KEYS.AI_ENABLED] && !!m[KEYS.DISCLAIMER_AGREED];
                const brutal = !!m[KEYS.BRUTAL];
                // 未开 AI 且未开暴力：直接下一节
                if (!aiOn && !brutal) {
                    if (this._quizSkipDone) return;
                    this._quizSkipDone = true;
                    this._quizAiTried = true;
                    if (typeof Quiz !== 'undefined' && Quiz.skipVideoQuizToNext) {
                        Quiz.skipVideoQuizToNext('未开 AI/暴力模式，跳过视频弹题');
                    }
                    return;
                }
                if (AIBrain._running) return;
                if (AIBrain._lastResult && AIBrain._lastResult.applyFailed && !brutal) return;

                const type = (typeof Quiz !== 'undefined' && Quiz.getVideoQuizType) ? Quiz.getVideoQuizType() : null;

                // 多选：所有模式统一——AI 开则只试一次，失败/未开 AI 都跳下一节
                if (type === 'multi') {
                    this._quizAiTried = true;
                    if (!aiOn) {
                        if (this._quizSkipDone) return;
                        this._quizSkipDone = true;
                        if (typeof Quiz !== 'undefined' && Quiz.skipVideoQuizToNext) {
                            Quiz.skipVideoQuizToNext('多选弹题：未开 AI，跳过下一节');
                        }
                        return;
                    }
                    console.log('🧠 视频多选弹题：AI 试一次，失败则跳下一节');
                    Promise.resolve(AIBrain.runVideoQuizOnce({ allowEnumerate: false, forceAi: true }))
                        .catch(() => ({ ok: false }))
                        .then(r => {
                            if (!r || !r.ok) {
                                if (typeof Quiz !== 'undefined' && Quiz.skipVideoQuizToNext) {
                                    Quiz.skipVideoQuizToNext('多选弹题：AI 未成功，进入下一节');
                                }
                            } else {
                                this._afterVideoQuizHandled();
                            }
                        });
                    return;
                }

                // 判断/单选：暴力开 → 枚举；否则 AI（若开着）
                this._quizAiTried = true;
                const allowEnumerate = brutal;
                console.log(allowEnumerate
                    ? '🧠 视频弹题：暴力枚举模式'
                    : '🧠 视频弹题：AI 答题模式');
                Promise.resolve(AIBrain.runVideoQuizOnce({ allowEnumerate }))
                    .catch(() => ({ ok: false }))
                    .then(r => {
                        if (!r || !r.ok) {
                            if (typeof Quiz !== 'undefined' && Quiz.skipVideoQuizToNext) {
                                Quiz.skipVideoQuizToNext('视频弹题未成功，进入下一节');
                            }
                        } else {
                            this._afterVideoQuizHandled();
                        }
                    });
            });
        }
        return true;
    },

    /** 弹题处理成功后：复位尝试标记，弹题消失则恢复播放 */
    _afterVideoQuizHandled: function () {
        setTimeout(() => {
            if (!this._quizVisible()) {
                this._quizAiTried = false;
                this._quizBlocked = false;
                this._quizSkipDone = false;
                const v = document.querySelector('video') || document.querySelector('.vjs-tech');
                if (v && !v.ended && !this.isFinished) {
                    v.play().catch(() => {});
                }
            }
        }, 600);
    },

    /**
     * 本次任务的完成阈值：
     *  - 超强模式：右偏加权分布（100%×30%、97-99%×50%、91-96%×20%）——更像真人完成位置
     *  - 随机进度：91~100 均匀
     *  - 否则固定值
     */
    _pickDonePct: function () {
        if (this.stealth) {
            const r = Math.random();
            if (r < 0.30) return 100;
            if (r < 0.80) return 97 + Math.floor(Math.random() * 3); // 97,98,99
            return 91 + Math.floor(Math.random() * 6);               // 91..96
        }
        if (this.rndDone) return 91 + Math.floor(Math.random() * 10); // 91..100
        return this.targetDonePct;
    },

    play: function (data) {
        data = data || {};
        const pct = parseInt(data.donePct, 10);
        if (pct >= 10 && pct <= 100) this.targetDonePct = pct;
        this.rndDone = !!data.rndDone;
        this.rndBlur = !!data.rndBlur;
        this.stealth = !!data.stealth;
        this._currentThreshold = this._pickDonePct();

        this._clearBlurTimers();
        if (this._finishTimer) { clearTimeout(this._finishTimer); this._finishTimer = null; }
        this._finishPending = false;
        this._blurred = false;
        this._blurPaused = false;
        this._refocusAt = null;
        this._blurScheduledFor = null; // 新视频重新调度失焦
        this._quizBlocked = false;
        this._quizAiTried = false;
        this._quizSkipDone = false;

        if (this.isFinished) return;

        // 尝试寻找视频元素
        const video = document.querySelector('video') || document.querySelector('.vjs-tech');

        if (!video) {
            console.log("⏳ 视频元素还在加载中，1秒后重试...");
            setTimeout(() => this.play(data), 1000);
            return;
        }

        // 绑定事件 (确保只绑一次)
        if (!video.dataset.binded) {
            video.dataset.binded = "true";

            video.addEventListener('ended', () => {
                this._finish('ended');
            });

            // 防暂停：暂停后自动恢复（随机失焦 / 视频弹题期间让路）
            video.addEventListener('pause', () => {
                if (!video.ended && !this.isFinished && !this._blurred && !this._quizVisible()) {
                    setTimeout(() => {
                        if (this._blurred || this.isFinished || video.ended || this._quizVisible()) return;
                        this._resumePlay(video, 0);
                    }, 500);
                }
            });
        }

        // 静音原速播放
        video.muted = true;

        if (video.paused && !video.ended && !this._quizVisible()) {
            video.play().catch(e => console.log("播放被拦截", e));
        }

        // 巡检：进度阈值 + 弹题 + 惰性调度失焦（拿到 duration 后按播放位置安排）
        this._startKeepAlive();
    },

    /** 统一完成出口（幂等）：达标延迟 / ended / 进度巡检共用 */
    _finish: function (reason, progress) {
        if (this.isFinished) return;
        this.isFinished = true;
        this._finishPending = false;
        if (this._finishTimer) { clearTimeout(this._finishTimer); this._finishTimer = null; }
        this._clearBlurTimers();
        const pct = progress != null ? progress : Math.round(
            (() => {
                const v = document.querySelector('video');
                if (v && v.duration && isFinite(v.duration)) return (v.currentTime / v.duration) * 100;
                return 100;
            })()
        );
        console.log(`🏁 视频任务完成（${reason}，${pct}%）`);
        try {
            const v = document.querySelector('video');
            if (v) v.pause();
        } catch (e) {}
        window.parent.postMessage({ action: "TASK_FINISHED", type: "video", progress: pct }, '*');
    },

    /** ---- 超强模式：达标后随机延迟完成（消除精准卡点） ---- */
    _scheduleFinish: function (pctVal) {
        if (this._finishPending || this.isFinished) return;
        this._finishPending = true;
        const delay = this._randDelay(this.STEALTH_FINISH_DELAY);
        console.log(`[防风控] 已达标，随机延迟 ${Math.round(delay / 1000)}s 后完成任务`);
        this._finishTimer = setTimeout(() => {
            this._finish('stealth-delay', pctVal);
        }, delay);
    },

    /** ---- 防风控：随机失焦 ----
     * 关键修正：短视频（约 8 分钟）等不起 15 分钟墙钟计时器——
     * 改为按【视频播放位置】触发：25%~75% 进度处随机失焦，
     * 每视频 60% 概率触发 → 整体期望约 15 分钟一次失焦。
     */
    _shouldBlur: function () {
        return Math.random() < this.BLUR_TRIGGER_CHANCE;
    },

    _scheduleBlurAt: function (duration) {
        if (this._blurTimer || this._blurred || this.isFinished) return;
        if (!this._shouldBlur()) { this._blurScheduledFor = 'skipped'; return; }
        const [lo, hi] = this.BLUR_POS_RANGE;
        const posRatio = lo + Math.random() * (hi - lo);
        const delaySec = Math.max(10, duration * posRatio);
        this._blurScheduledFor = delaySec;
        console.log(`[防风控] 已按播放位置调度失焦：视频 ${Math.round(duration)}s 的 ${Math.round(posRatio * 100)}% 处（${Math.round(delaySec)}s 后）`);
        this._blurTimer = setTimeout(() => this._doBlur(), delaySec * 1000);
    },

    _doBlur: function () {
        if (!(this.rndBlur || this.stealth) || this.isFinished || this._blurred) return;
        // 失焦时长：1~30 分钟（60 + 指数 mean 2 分钟），平均正好 3 分钟
        //   中位约 2.4 分钟，范围 [60s, 1800s]
        // 超强模式 15% 长休息：5~15 分钟
        let dur;
        if (this.stealth && Math.random() < 0.15) {
            dur = 300 + Math.floor(Math.random() * 600); // 5~15 分钟长休息
        } else {
            dur = 60 + Math.min(1740, this._expRandom(120));
        }
        this._blurred = true;

        const v = document.querySelector('video') || document.querySelector('.vjs-tech');
        if (v && !v.paused && !v.ended) {
            this._blurPaused = true;
            try { v.pause(); } catch (e) {}
        }

        // 触发页面监听的失焦事件（模拟真人切出窗口）
        try {
            window.dispatchEvent(new Event('blur'));
            window.dispatchEvent(new Event('focusout'));
        } catch (e) {}
        console.log(`[防风控] 随机失焦 ${dur}s${dur >= 300 ? '（长休息）' : ''}`);

        // 恢复时间戳 + 双通道触发（setTimeout 主通道，keepAlive 时间戳兜底）
        this._refocusAt = Date.now() + dur * 1000;
        if (this._refocusTimer) clearTimeout(this._refocusTimer);
        this._refocusTimer = setTimeout(() => this._restoreFocus(), dur * 1000);
    },

    _restoreFocus: function () {
        if (!this._blurred) return; // 幂等：双通道只生效一次
        this._blurred = false;
        this._refocusAt = null;
        if (this._refocusTimer) { clearTimeout(this._refocusTimer); this._refocusTimer = null; }
        try {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('focusin'));
        } catch (e) {}
        console.log('[防风控] 恢复焦点，继续播放');

        // 无条件尝试恢复播放（不依赖 _blurPaused：失焦期间缓冲暂停的场景也要拉起）
        const v = document.querySelector('video') || document.querySelector('.vjs-tech');
        if (!this.isFinished && v && v.paused && !v.ended) {
            this._resumePlay(v, 0);
        }
        this._blurPaused = false;
    },

    /** 带重试的恢复播放：play() Promise 被播放器拒绝时 1s 后重试（最多 5 次） */
    _resumePlay: function (v, attempt) {
        if (this.isFinished || this._blurred || this._quizVisible() || !v || !v.paused || v.ended) return;
        try {
            const p = v.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    if (attempt < 5) setTimeout(() => this._resumePlay(v, attempt + 1), 1000);
                });
            }
        } catch (e) {
            if (attempt < 5) setTimeout(() => this._resumePlay(v, attempt + 1), 1000);
        }
    },

    _clearBlurTimers: function () {
        if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
        if (this._refocusTimer) { clearTimeout(this._refocusTimer); this._refocusTimer = null; }
        // 注意：不清 _refocusAt 的兜底逻辑由 isFinished/_blurred 状态守卫
    },

    /** ---- 进度巡检 ---- */
    _startKeepAlive: function () {
        if (this._keepAlive) return;
        this._keepAlive = setInterval(() => {
            if (this.isFinished) {
                clearInterval(this._keepAlive);
                this._keepAlive = null;
                return;
            }
            // 视频弹题优先：展示期间暂停，且不按进度完成任务
            if (this._checkVideoQuiz()) return;

            const v = document.querySelector('video') || document.querySelector('.vjs-tech');
            if (!v || v.ended) return;

            // 恢复兜底：setTimeout 丢失/被清/被节流时，按时间戳补触发（不依赖 duration）
            if (this._blurred && this._refocusAt && Date.now() >= this._refocusAt) {
                console.log('[防风控] 定时器兜底触发恢复');
                this._restoreFocus();
            }

            const dur = v.duration;
            if (dur && isFinite(dur) && dur > 0) {
                // 惰性调度：拿到 duration 后按播放位置安排失焦（每视频一次）
                if ((this.rndBlur || this.stealth) && !this.isFinished &&
                    this._blurTimer === null && this._blurScheduledFor === null &&
                    dur >= this.BLUR_MIN_VIDEO) {
                    this._scheduleBlurAt(dur);
                }

                const ratio = (v.currentTime || 0) / dur;
                const pctVal = Math.round(ratio * 100);

                try {
                    window.top.postMessage({
                        action: 'VIDEO_PROGRESS',
                        pct: Math.min(pctVal, 100),
                        stealthOn: this.rndBlur || this.stealth,
                        blurred: this._blurred,
                        // 失焦剩余秒数（供全屏提示倒计时）
                        blurRemain: this._blurred && this._refocusAt
                            ? Math.max(0, Math.ceil((this._refocusAt - Date.now()) / 1000))
                            : 0
                    }, '*');
                } catch (e) {}

                const threshold = this._currentThreshold || this.targetDonePct;
                if (ratio * 100 >= threshold) {
                    if (this.stealth && !this._finishPending) {
                        // 超强模式：达标后随机延迟 2~15s 再完成（消除精准卡点）
                        this._scheduleFinish(pctVal);
                    } else if (!this._finishPending) {
                        this._finish('threshold', pctVal);
                    }
                }
            }
        }, 1500);
    }
};

window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'START_VIDEO') {
        VideoWorker.play(event.data);
    }
});

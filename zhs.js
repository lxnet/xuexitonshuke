// zhs.js - 智慧树平台适配器（视频自动刷课 + PDF 页目录跳转）
// 智慧树：Vue SPA + videojs 播放器（vjs-tech），目录项 tick-circle.png = 已完成
// 无焦点/切屏检测 → 原速静音播放即可；完成判定由服务端按观看记录，播完即完成
console.log("🌲 智慧树适配器已挂载");

const Zhs = {
    _endedFlag: false,        // 当前资源已完成（防重复触发）
    _endedDone: false,        // 已发出完成动作
    _pdfHinted: false,        // 文档页提示（每页面文档一次，不随 reset 清除）
    _docJumped: false,        // 本页已尝试目录跳转（防重复点击）

    /** 主循环（由 main.js 按平台分发调用，2s 周期） */
    tick: function (m) {
        // 1) 视频页：接管播放
        const v = document.querySelector('video.vjs-tech, video');
        if (v) {
            this._ensurePlay(v, m);
            return;
        }
        // 2) PDF/文档预览页：云渲染无法本地自动化 → 提示并目录跳转
        if (this._isDocPage()) {
            if (!this._pdfHinted) {
                this._pdfHinted = true;
                toast('📄 文档类资源暂不支持自动学习，将跳转下一未完成章节');
            }
            this._gotoNextUnfinished();
            return;
        }
        // 3) 无播放器页面：直接找未完成章节
        this._gotoNextUnfinished();
    },

    _ensurePlay: function (v, m) {
        v.muted = true;
        if (!v.dataset.zhsBound) {
            v.dataset.zhsBound = '1';
            // 防暂停：暂停后原速恢复（与学习通同策略，但不碰 playbackRate）
            v.addEventListener('pause', () => {
                if (!v.ended) setTimeout(() => {
                    if (!v.ended) { try { v.play(); } catch (e) {} }
                }, 500);
            });
            v.addEventListener('ended', () => this._onVideoEnded());
        }
        if (v.paused && !v.ended) {
            try { v.play(); } catch (e) {}
        }

        const dur = v.duration;
        if (dur && isFinite(dur) && dur > 0) {
            const pct = Math.round((v.currentTime || 0) / dur * 100);
            // 进度上报复用通用胶囊（顶层 VIDEO_PROGRESS 监听已就绪）
            try {
                window.top.postMessage({
                    action: 'VIDEO_PROGRESS',
                    pct: Math.min(pct, 100),
                    stealthOn: false,
                    blurred: false
                }, '*');
            } catch (e) {}
            // 智慧树默认阈值 100（播完即完成；用户可自行调低）
            const th = parseInt(m[KEYS.VIDEO_DONE_PCT], 10) || 100;
            if (!this._endedFlag && pct >= th) this._onVideoEnded();
        }
    },

    _onVideoEnded: function () {
        if (this._endedDone) return;
        this._endedDone = true;
        this._endedFlag = true;
        toast('✅ 视频播放完成，准备进入下一节...');
        setTimeout(() => {
            this._reset();
            this._gotoNextUnfinished(true);
        }, 2500);
    },

    _reset: function () {
        this._endedFlag = false;
        this._endedDone = false;
        this._docJumped = false;
        // 注意：_pdfHinted 不清（每页面文档只提示一次）
    },

    /** 目录驱动跳转：点击下一个未完成【知识点】条目（非章标题）
     * 依据真实样本：
     *  - 目录两级：章(.section-item 的 title-text 是折叠开关) → 知识点(.section-item-collapse-info)
     *  - 进入学习的真正入口 = 知识点条目 title-text（点击后预览区切换 PDF/视频资源）
     *  - 完成图标在知识点级；当前学习中的知识点有 .active 标识
     *  - PDF 学完 → 点下一个视频知识点 → 预览区切换为视频 → 播放器接管自动续播
     */
    _gotoNextUnfinished: function (afterDone) {
        if (this._docJumped) return false; // 本页已尝试过，防重复点击
        const entries = document.querySelectorAll('.section-item-collapse-info');
        for (const it of entries) {
            // 跳过当前知识点（刚学完/正在学，图标可能尚未刷新）
            if (it.classList.contains('active')) continue;
            const icon = it.querySelector('img');
            const done = !!(icon && /tick-circle/i.test(icon.getAttribute('src') || ''));
            const title = it.querySelector('.title-text');
            if (!done && title) {
                toast('📍 跳转未完成知识点：' + (title.innerText || '').trim().slice(0, 24));
                Utils.safeClick(title);
                this._docJumped = true;
                this._endedFlag = false;
                this._endedDone = false;
                return true;
            }
        }
        if (afterDone) toast('🎉 未发现未完成知识点');
        return false;
    },

    _isDocPage: function () {
        return !!document.querySelector(
            'iframe[src*="officeView"], .preview-section iframe, .diagram-preview, .office-view'
        );
    },

    stop: function () { this._reset(); }
};

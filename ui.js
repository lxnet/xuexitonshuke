// ui.js - 控制面板（深色面板 / 靛蓝强调色）

const UI = {
    config: {
        id: "cx-dashboard",
        zIndex: "2147483647"
    },

    DISCLAIMER_SECONDS: 5, // 强制阅读时长（秒）
    _discTimer: null,
    // AI 配置输入框：用户点选/输入后标记 touched，updateState 不再用 storage 回填（否则清空 Key 会被立刻填回）
    _aiTouched: {},

    CSS: `
        #cx-dashboard {
            --cx-bg: #111827;
            --cx-surface: #1F2937;
            --cx-surface-raised: #273449;
            --cx-border: #374151;
            --cx-text: #F3F4F6;
            --cx-muted: #9CA3AF;
            --cx-accent: #818CF8;
            position: fixed; top: 12px; right: 16px; width: 336px; max-width: calc(100vw - 24px);
            background: var(--cx-bg); border: 1px solid var(--cx-border); border-radius: 14px;
            box-shadow: 0 16px 44px rgba(0,0,0,.42), 0 2px 8px rgba(0,0,0,.22);
            font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: var(--cx-text); z-index: 2147483647; overflow: hidden;
            color-scheme: dark;
        }
        #cx-dashboard * { box-sizing: border-box; }
        #cx-dashboard .cx-header {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding: 13px 14px; border-bottom: 1px solid var(--cx-border);
            background: linear-gradient(125deg, #202C48 0%, #111827 74%);
            cursor: move; user-select: none; font-weight: 700; font-size: 14px;
        }
        #cx-dashboard .cx-brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
        #cx-dashboard .cx-brand-mark {
            display: grid; place-items: center; width: 34px; height: 34px; flex: none;
            border: 1px solid rgba(165,180,252,.3); border-radius: 10px;
            color: #E0E7FF; background: linear-gradient(145deg,#6366F1,#4338CA);
            font-size: 13px; font-weight: 800; letter-spacing: -.04em;
            box-shadow: 0 4px 12px rgba(79,70,229,.26);
        }
        #cx-dashboard .cx-brand-copy { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; min-width: 0; }
        #cx-dashboard .cx-brand-name { color: #F8FAFC; font-size: 13px; white-space: nowrap; }
        #cx-dashboard .cx-ver { font-weight: 500; font-size: 10px; color: #A5B4FC; margin-left: 5px; }
        #cx-dashboard .cx-header-actions { display: flex; align-items: center; gap: 6px; flex: none; }
        #cx-dashboard .cx-contact {
            display: inline-flex; align-items: center; min-height: 25px; padding: 0 7px;
            border: 1px solid #414D68; border-radius: 7px; background: rgba(129,140,248,.08);
            color: #C7D2FE; font-family: inherit; font-size: 10px; font-weight: 600; line-height: 1.3; white-space: nowrap;
            cursor: pointer; transition: background .15s, border-color .15s;
        }
        #cx-dashboard .cx-contact:hover { background: rgba(129,140,248,.17); border-color: #6875A0; }
        #cx-dashboard .cx-contact:focus-visible { outline: 2px solid #A5B4FC; outline-offset: 2px; }
        #cx-contact-modal {
            position: fixed; inset: 0; z-index: 2147483647; display: flex;
            align-items: center; justify-content: center; padding: 16px;
            background: rgba(2,6,23,.76); opacity: 0; visibility: hidden; pointer-events: none;
            transition: opacity .18s ease, visibility .18s ease;
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        #cx-contact-modal.on { opacity: 1; visibility: visible; pointer-events: auto; }
        #cx-contact-modal *, #cx-contact-modal *::before, #cx-contact-modal *::after { box-sizing: border-box; }
        #cx-contact-modal .cx-contact-dialog {
            width: 352px; max-width: calc(100vw - 32px); padding: 17px;
            border: 1px solid #3B475B; border-radius: 16px; background: #111827;
            color: #F3F4F6; box-shadow: 0 24px 72px rgba(0,0,0,.58);
            transform: translateY(8px) scale(.98); transition: transform .18s ease;
        }
        #cx-contact-modal.on .cx-contact-dialog { transform: translateY(0) scale(1); }
        #cx-contact-modal .cx-contact-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
        #cx-contact-modal .cx-contact-title { font-size: 14px; font-weight: 700; }
        #cx-contact-modal .cx-contact-subtitle { margin-top: 3px; color: #94A3B8; font-size: 11px; }
        #cx-contact-modal #cx-contact-close {
            display: grid; place-items: center; width: 29px; height: 29px; flex: none;
            border: 1px solid #3B475B; border-radius: 8px; background: #1F2937;
            color: #CBD5E1; font: 20px/1 sans-serif; cursor: pointer;
        }
        #cx-contact-modal #cx-contact-close:hover { background: #303B4F; }
        #cx-contact-modal .cx-contact-qr-wrap {
            display: grid; place-items: center; padding: 12px;
            border: 1px solid #344158; border-radius: 13px; background: #0B1220;
        }
        #cx-contact-modal .cx-contact-qr {
            display: block; width: 280px; height: 280px; max-width: 100%; max-height: calc(100vw - 104px);
            object-fit: contain; padding: 8px; border-radius: 10px; background: #fff;
        }
        #cx-contact-modal .cx-contact-caption { margin-top: 11px; color: #C7D2FE; text-align: center; font-size: 11px; }
        #cx-contact-modal #cx-contact-close:focus-visible { outline: 2px solid #A5B4FC; outline-offset: 2px; }
        #cx-dashboard #btn-collapse {
            cursor: pointer; width: 26px; height: 26px; line-height: 24px; text-align: center;
            font-size: 16px; color: #CBD5E1; border-radius: 7px; border: 1px solid transparent;
            background: rgba(255,255,255,.06); flex: none;
        }
        #cx-dashboard #btn-collapse:hover { background: rgba(255,255,255,.12); border-color: #475569; }
        #cx-dashboard .cx-body { padding: 13px 14px 12px; max-height: calc(100vh - 72px); overflow: auto; }
        #cx-dashboard .cx-body::-webkit-scrollbar { width: 7px; }
        #cx-dashboard .cx-body::-webkit-scrollbar-thumb { background: #475569; border-radius: 8px; }
        #cx-dashboard .cx-body::-webkit-scrollbar-track { background: transparent; }
        #cx-dashboard .cx-status {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 11px; color: #CBD5E1; margin: 0 0 2px; padding: 5px 9px;
            border: 1px solid var(--cx-border); border-radius: 999px; background: #172033;
        }
        #cx-dashboard .cx-dot { width: 7px; height: 7px; border-radius: 50%; background: #64748B; flex: none; }
        #cx-dashboard .cx-status.on .cx-dot { background: #34D399; box-shadow: 0 0 9px rgba(52,211,153,.65); }
        #cx-dashboard .cx-status.on { color: #A7F3D0; border-color: rgba(52,211,153,.3); }
        #cx-dashboard .cx-section {
            padding: 13px 12px 12px; margin-top: 11px; border: 1px solid #2E3A50;
            border-radius: 11px; background: linear-gradient(145deg,#1A2435,#172131);
        }
        #cx-dashboard .cx-section.first {
            padding: 13px 12px 12px; margin-top: 10px; border: 1px solid #3B4770;
            background: linear-gradient(145deg,#202B47,#192338);
        }
        #cx-dashboard .cx-label {
            display: flex; align-items: center; justify-content: space-between;
            font-size: 11px; font-weight: 700; color: #A5B4FC; letter-spacing: .045em; margin-bottom: 9px;
        }
        #cx-dashboard .cx-select, #cx-dashboard .cx-input {
            width: 100%; height: 34px; padding: 0 10px;
            border: 1px solid #3B475B; border-radius: 8px;
            font-size: 12px; font-family: inherit; color: var(--cx-text); background: #0F172A; outline: none;
            transition: border-color .15s, box-shadow .15s, background .15s;
        }
        #cx-dashboard .cx-input::placeholder { color: #64748B; }
        #cx-dashboard .cx-select:focus, #cx-dashboard .cx-input:focus {
            border-color: #818CF8; box-shadow: 0 0 0 3px rgba(129,140,248,.17); background: #111B31;
        }
        #cx-dashboard .cx-field { margin-bottom: 7px; }
        #cx-dashboard .cx-btn {
            display: block; width: 100%; min-height: 35px; padding: 7px 10px;
            border: 1px solid transparent; border-radius: 8px;
            font-size: 12px; font-weight: 650; font-family: inherit; cursor: pointer;
            transition: transform .12s, background .15s, border-color .15s, opacity .15s;
        }
        #cx-dashboard .cx-btn:hover { transform: translateY(-1px); }
        #cx-dashboard .cx-btn:active { opacity: .86; transform: translateY(0); }
        #cx-dashboard .cx-btn-primary { background: #6366F1; color: #fff; box-shadow: 0 5px 14px rgba(99,102,241,.22); }
        #cx-dashboard .cx-btn-primary:hover { background: #5558E8; }
        #cx-dashboard .cx-btn-soft { background: #303768; color: #C7D2FE; border-color: #454B83; }
        #cx-dashboard .cx-btn-soft:hover { background: #3A4380; }
        #cx-dashboard .cx-btn-ghost { background: #202B3D; color: #E2E8F0; border-color: #3B475B; }
        #cx-dashboard .cx-btn-ghost:hover { background: #2B384D; border-color: #58677F; }
        #cx-dashboard .cx-btn-danger { background: transparent; color: #FCA5A5; font-weight: 550; }
        #cx-dashboard .cx-btn-danger:hover { background: rgba(239,68,68,.12); }
        #cx-dashboard .cx-two { display: flex; gap: 8px; }
        #cx-dashboard .cx-two .cx-btn { flex: 1; }
        #cx-dashboard .cx-hint { font-size: 10.5px; color: #94A3B8; text-align: center; margin-top: 6px; line-height: 1.55; }
        #cx-dashboard .cx-info { font-size: 11px; color: #A7B4C8; text-align: center; margin: 7px 0 2px; }
        #cx-dashboard #ai-tutorial { color: #A5B4FC !important; }
        #cx-dashboard #anti-section .cx-hint[style*="text-align:left"] { color: #94A3B8 !important; }
        #cx-dashboard #anti-section span[style*="color"] { color: #C7D2FE !important; }
        #cx-dashboard #done-pct + span { color: #A7B4C8 !important; }
        /* 滑块开关 */
        #cx-dashboard .cx-switch { position: relative; display: inline-block; width: 34px; height: 19px; flex: none; }
        #cx-dashboard .cx-switch input {
            position: absolute; inset: 0; width: 100%; height: 100%;
            margin: 0; opacity: 0; cursor: pointer; z-index: 1;
        }
        #cx-dashboard .cx-switch .cx-slider {
            position: absolute; inset: 0; background: #475569; border-radius: 999px;
            transition: background .15s; cursor: pointer;
        }
        #cx-dashboard .cx-switch .cx-slider::before {
            content: ""; position: absolute; width: 15px; height: 15px; left: 2px; top: 2px;
            background: #E2E8F0; border-radius: 50%; transition: transform .15s;
            box-shadow: 0 1px 3px rgba(0,0,0,.35);
        }
        #cx-dashboard .cx-switch input:checked + .cx-slider { background: #6366F1; }
        #cx-dashboard .cx-switch input:checked + .cx-slider::before { transform: translateX(15px); background: #fff; }
        #cx-dashboard .cx-switch input:focus-visible + .cx-slider { outline: 2px solid #A5B4FC; outline-offset: 2px; }
        #cx-dashboard .cx-switch input:disabled + .cx-slider { opacity: .55; cursor: not-allowed; }
        #cx-dashboard .cx-footer { margin-top: 11px; padding: 10px 4px 0; border-top: 1px solid #293548; }
        /* 悬浮进度胶囊（面板左侧） */
        #cx-capsule {
            position: fixed; top: 16px; right: 330px;
            background: #4F46E5; color: #fff;
            padding: 7px 14px; border-radius: 999px;
            font: 650 12px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
            box-shadow: 0 5px 18px rgba(79,70,229,.4); border: 1px solid rgba(199,210,254,.2);
            z-index: 2147483647; display: none;
            white-space: nowrap; user-select: none; pointer-events: none;
        }
        #cx-capsule.done { background: #047857; box-shadow: 0 5px 18px rgba(5,150,105,.35); }
        /* 隐藏模式状态胶囊（进度胶囊下方） */
        #cx-blur-status {
            position: fixed; top: 59px; right: 330px;
            padding: 6px 12px; border-radius: 999px;
            font: 600 11px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
            z-index: 2147483647; display: none;
            white-space: nowrap; user-select: none; pointer-events: none;
            background: #1F2937; color: #CBD5E1; border: 1px solid #475569;
            box-shadow: 0 5px 16px rgba(0,0,0,.28); transition: background .2s, color .2s;
        }
        #cx-blur-status.active { background: #B45309; color: #FFF7ED; border-color: transparent; }
        /* 失焦全屏提示 */
        #cx-blur-overlay {
            position: fixed; inset: 0; background: rgba(2,6,23,.78);
            z-index: 2147482000; display: flex; align-items: center; justify-content: center;
            opacity: 0; visibility: hidden; pointer-events: none;
            transition: opacity .35s ease, visibility .35s ease;
        }
        #cx-blur-overlay.on { opacity: 1; visibility: visible; }
        #cx-blur-overlay .cx-blur-card {
            background: #111827; border: 1px solid #374151; border-radius: 18px;
            padding: 30px 42px; text-align: center; min-width: 320px; max-width: calc(100vw - 32px);
            box-shadow: 0 24px 70px rgba(0,0,0,.55); transform-origin: top right;
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        #cx-blur-overlay.on .cx-blur-card { animation: cx-blur-expand .45s cubic-bezier(.2, .85, .3, 1.05); }
        @keyframes cx-blur-expand {
            from { opacity: 0; transform: translate(220px, -160px) scale(.18); }
            55% { opacity: 1; }
            to { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        #cx-blur-overlay .cx-blur-title { font-size: 17px; font-weight: 700; color: #F8FAFC; margin-bottom: 7px; }
        #cx-blur-overlay .cx-blur-sub { font-size: 13px; color: #A7B4C8; line-height: 1.7; margin-bottom: 14px; }
        #cx-blur-overlay .cx-blur-count { font-size: 44px; font-weight: 700; color: #FBBF24; font-variant-numeric: tabular-nums; letter-spacing: 2px; margin: 4px 0 12px; }
        #cx-blur-overlay .cx-blur-hint { display: inline-block; font-size: 12px; color: #FDE68A; background: #422006; border: 1px solid #713F12; border-radius: 999px; padding: 5px 14px; }
        /* 首次使用免责声明 */
        #cx-disclaimer {
            position: fixed; inset: 0; background: rgba(2,6,23,.8);
            z-index: 2147483647; display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        #cx-disclaimer .cx-dlg {
            width: 440px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px);
            background: #111827; border: 1px solid #374151; border-radius: 15px; overflow: hidden;
            box-shadow: 0 24px 70px rgba(0,0,0,.55); display: flex; flex-direction: column;
        }
        #cx-disclaimer .cx-dlg-head { background: linear-gradient(120deg,#4338CA,#6366F1); color: #fff; padding: 15px 19px; font-size: 15px; font-weight: 700; }
        #cx-disclaimer .cx-dlg-body { padding: 17px 19px; font-size: 13px; line-height: 1.75; color: #D1D5DB; overflow-y: auto; flex: 1; }
        #cx-disclaimer .cx-dlg-body ol { margin: 0; padding-left: 20px; }
        #cx-disclaimer .cx-dlg-body li { margin-bottom: 8px; }
        #cx-disclaimer .cx-dlg-warn { margin-top: 10px; padding: 10px 12px; background: #351B25; border: 1px solid #713344; border-radius: 9px; color: #FDA4AF; font-size: 12.5px; }
        #cx-disclaimer .cx-dlg-foot { padding: 12px 18px 15px; border-top: 1px solid #293548; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        #cx-disclaimer .cx-count { font-size: 12px; color: #A7B4C8; }
        #cx-disclaimer .cx-agree { border: 1px solid #475569; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 650; cursor: not-allowed; font-family: inherit; background: #273449; color: #94A3B8; transition: background .2s, color .2s; }
        #cx-disclaimer .cx-agree.ready { background: #6366F1; border-color: #818CF8; color: #fff; cursor: pointer; }
        #cx-disclaimer .cx-agree.ready:hover { background: #5558E8; }
        @media (max-width: 420px) {
            #cx-dashboard { right: 8px; top: 8px; width: calc(100vw - 16px); max-width: none; }
            #cx-dashboard .cx-header { padding: 11px 10px; }
            #cx-dashboard .cx-brand { gap: 7px; }
            #cx-dashboard .cx-contact { padding: 0 5px; font-size: 9px; }
            #cx-capsule, #cx-blur-status { right: auto; left: 8px; }
            #cx-blur-overlay .cx-blur-card { min-width: 0; padding: 26px 22px; }
        }
        @media (prefers-reduced-motion: reduce) {
            #cx-dashboard *, #cx-blur-overlay, #cx-blur-overlay .cx-blur-card { transition-duration: .01ms !important; animation-duration: .01ms !important; }
        }
    `,

    /** 纯 DOM 构建助手（不使用 innerHTML / HTML 解析 API，满足商店安全审核） */
    _el: function (tag, props, ...children) {
        const e = document.createElement(tag);
        if (props) {
            for (const k in props) {
                const v = props[k];
                if (k === 'class') e.className = v;
                else if (k === 'text') e.textContent = v;
                else if (k === 'style') e.style.cssText = v;
                else e.setAttribute(k, v);
            }
        }
        children.flat(Infinity).forEach(c => {
            if (c == null) return;
            e.appendChild((c && c.nodeType) ? c : document.createTextNode(String(c)));
        });
        return e;
    },

    /** 小节标题行（可选右侧开关） */
    _labelRow: function (text, switchId, labelStyle) {
        const label = this._el('div', { class: 'cx-label' },
            this._el('span', { style: labelStyle || '', text })
        );
        if (switchId) {
            label.appendChild(this._el('label', { class: 'cx-switch' },
                this._el('input', { type: 'checkbox', id: switchId }),
                this._el('span', { class: 'cx-slider' })
            ));
        }
        return label;
    },

    /** 开关行：文字 + 滑块 */
    _switchRow: function (labelText, inputId, labelStyle) {
        return this._el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;' },
            this._el('span', { style: labelStyle || 'font-size:12px;', text: labelText }),
            this._el('label', { class: 'cx-switch' },
                this._el('input', { type: 'checkbox', id: inputId }),
                this._el('span', { class: 'cx-slider' })
            )
        );
    },

    inject: function () {
        if (window.self !== window.top || document.getElementById(this.config.id)) return;

        if (!document.getElementById('cx-ui-style')) {
            const style = document.createElement('style');
            style.id = 'cx-ui-style';
            style.textContent = this.CSS;
            document.head.appendChild(style);
        }

        const div = document.createElement('div');
        div.id = this.config.id;
        div.appendChild(this.renderTemplate()); // 纯 DOM 构建
        document.body.appendChild(div);

        // 联系开发者二维码弹窗
        const contactModal = this._el('div', { id: 'cx-contact-modal', 'aria-hidden': 'true' },
            this._el('div', { class: 'cx-contact-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cx-contact-title' },
                this._el('div', { class: 'cx-contact-dialog-head' },
                    this._el('div', {},
                        this._el('div', { class: 'cx-contact-title', id: 'cx-contact-title', text: '联系开发者' }),
                        this._el('div', { class: 'cx-contact-subtitle', text: '扫码添加，欢迎反馈问题与建议' })
                    ),
                    this._el('button', { id: 'cx-contact-close', type: 'button', 'aria-label': '关闭二维码弹窗', text: '×' })
                ),
                this._el('div', { class: 'cx-contact-qr-wrap' },
                    this._el('img', {
                        class: 'cx-contact-qr',
                        src: 'https://img.remit.ee/i/JtG0g8iRby4d',
                        alt: '联系开发者二维码'
                    })
                ),
                this._el('div', { class: 'cx-contact-caption', text: '使用手机扫码联系开发者' })
            )
        );
        document.body.appendChild(contactModal);
        const contactQrImage = contactModal.querySelector('.cx-contact-qr');
        const contactQrCaption = contactModal.querySelector('.cx-contact-caption');
        if (contactQrImage) {
            contactQrImage.addEventListener('error', () => {
                contactQrImage.style.display = 'none';
                if (contactQrCaption) contactQrCaption.innerText = '二维码暂时无法加载，请检查网络或图片链接';
            }, { once: true });
        }

        // 独立悬浮进度胶囊（视频任务时显示）
        const capsule = document.createElement('div');
        capsule.id = 'cx-capsule';
        const capTxt = document.createElement('span');
        capTxt.id = 'cx-capsule-text';
        capTxt.innerText = '视频 0%';
        capsule.appendChild(capTxt);
        document.body.appendChild(capsule);

        // 隐藏模式状态胶囊（进度胶囊下方）
        const blurStatus = document.createElement('div');
        blurStatus.id = 'cx-blur-status';
        blurStatus.innerText = '';
        document.body.appendChild(blurStatus);

        // 失焦全屏提示（由状态胶囊"展开"而来，四周压暗 + 结束倒计时）
        const overlay = document.createElement('div');
        overlay.id = 'cx-blur-overlay';
        overlay.appendChild(this._el('div', { class: 'cx-blur-card' },
            this._el('div', { class: 'cx-blur-title', text: '隐藏模式生效中 · 不必接管' }),
            this._el('div', { class: 'cx-blur-sub' },
                this._el('span', { text: '已自动暂停并模拟切出窗口' }),
                document.createElement('br'),
                this._el('span', { text: '倒计时结束后自动恢复播放' })
            ),
            this._el('div', { class: 'cx-blur-count', id: 'cx-blur-count', text: '--:--' }),
            this._el('div', { class: 'cx-blur-hint', text: '请勿点击或操作页面' })
        ));
        document.body.appendChild(overlay);
        // 本地每秒递减倒计时（基准来自进度消息的 blurRemain）
        this._blurCountBase = null;
        setInterval(() => {
            const el = document.getElementById('cx-blur-count');
            const ov = document.getElementById('cx-blur-overlay');
            if (!el || !ov || !ov.classList.contains('on') || !this._blurCountBase) return;
            const { remain, at } = this._blurCountBase;
            const left = Math.max(0, remain - Math.floor((Date.now() - at) / 1000));
            const mm = String(Math.floor(left / 60)).padStart(2, '0');
            const ss = String(left % 60).padStart(2, '0');
            el.innerText = `${mm}:${ss}`;
        }, 1000);
        this._capsuleLastAt = 0;
        this._capsuleHideTimer = null;
        // 超时自动隐藏：8 秒无进度更新（转入文档任务/暂停等）
        setInterval(() => {
            if (this._capsuleVisible && Date.now() - this._capsuleLastAt > 8000) {
                this.hideCapsule();
            }
        }, 1000);

        this.bindEvents(div);
        this.makeDraggable(div);
        this.restoreState();

        // 首次使用：未同意免责协议则强制弹出（无关闭入口，刷新重新计时）
        State.get(m => {
            if (!m[KEYS.DISCLAIMER_AGREED]) this.showDisclaimer();
        });
    },

    /** ---- 免责声明弹窗 ---- */
    showDisclaimer: function () {
        if (document.getElementById('cx-disclaimer')) return;
        const box = document.createElement('div');
        box.id = 'cx-disclaimer';
        box.appendChild(this._el('div', { class: 'cx-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': '使用须知与免责声明' },
            this._el('div', { class: 'cx-dlg-head', text: '使用须知与免责声明' }),
            this._el('div', { class: 'cx-dlg-body' },
                this._el('ol', {},
                    this._el('li', {}, '本扩展仅供个人学习与技术交流使用，', this._el('b', {}, '严禁'), '用于任何违反学校教学管理规定、考试纪律或商业用途的行为。'),
                    this._el('li', {}, '因使用本扩展产生的一切后果（包括但不限于课程成绩异常、账号处罚、纪律处分等）均由', this._el('b', {}, '使用者本人承担'), '，开发者与分发者不承担任何责任。'),
                    this._el('li', {}, '本扩展不收集、不上传任何数据；所有配置与记录仅保存在浏览器本地。请在使用结束后 ', this._el('b', {}, '2 小时内删除本扩展及其本地数据'), '。'),
                    this._el('li', {}, '继续使用即表示您已阅读、理解并完全同意本协议全部条款。')
                ),
                this._el('div', { class: 'cx-dlg-warn', text: '⚠️ 请勿将本工具用于任何违规场景。因违规使用造成的任何损失与责任，均由使用者自行承担，与开发者无关。' })
            ),
            this._el('div', { class: 'cx-dlg-foot' },
                this._el('span', { class: 'cx-count', id: 'cx-disc-count', text: '请阅读 ' + this.DISCLAIMER_SECONDS + ' 秒（' + this.DISCLAIMER_SECONDS + '）' }),
                this._el('button', { class: 'cx-agree', id: 'cx-disc-agree', disabled: '', text: '我已阅读并同意' })
            )
        ));
        document.body.appendChild(box);

        const countEl = box.querySelector('#cx-disc-count');
        const agreeBtn = box.querySelector('#cx-disc-agree');
        const startAt = Date.now();

        agreeBtn.onclick = () => {
            const elapsed = (Date.now() - startAt) / 1000;
            if (elapsed < this.DISCLAIMER_SECONDS) return; // 倒计时未满，点击无效
            State.set({ [KEYS.DISCLAIMER_AGREED]: true }, () => {
                if (this._discTimer) { clearInterval(this._discTimer); this._discTimer = null; }
                box.remove();
                this.updateState();
            });
        };

        if (this._discTimer) clearInterval(this._discTimer);
        this._discTimer = setInterval(() => {
            const remain = Math.ceil(this.DISCLAIMER_SECONDS - (Date.now() - startAt) / 1000);
            if (remain > 0) {
                countEl.innerText = `请阅读 ${this.DISCLAIMER_SECONDS} 秒（${remain}）`;
            } else {
                countEl.innerText = '已可提交，点击下方按钮同意协议';
                agreeBtn.disabled = false;
                agreeBtn.classList.add('ready');
                clearInterval(this._discTimer);
                this._discTimer = null;
            }
        }, 250);
    },

    /** 操作前检查：未同意则弹免责并返回 false */
    ensureAgreed: function (cb) {
        State.get(m => {
            if (m[KEYS.DISCLAIMER_AGREED]) { cb(true); return; }
            this.showDisclaimer();
            cb(false);
        });
    },

    showContactQr: function () {
        const modal = document.getElementById('cx-contact-modal');
        if (!modal) return;
        this._contactPreviousFocus = document.activeElement;
        modal.classList.add('on');
        modal.setAttribute('aria-hidden', 'false');
        const close = document.getElementById('cx-contact-close');
        if (close) close.focus();
    },

    hideContactQr: function () {
        const modal = document.getElementById('cx-contact-modal');
        if (!modal) return;
        modal.classList.remove('on');
        modal.setAttribute('aria-hidden', 'true');
        if (this._contactPreviousFocus && this._contactPreviousFocus.isConnected) {
            this._contactPreviousFocus.focus();
        }
        this._contactPreviousFocus = null;
    },

    /** 面板主体：纯 DOM 构建（无 HTML 字符串解析） */
    renderTemplate: function () {
        const frag = document.createDocumentFragment();

        frag.appendChild(this._el('div', { class: 'cx-header', id: 'cx-header' },
            this._el('div', { class: 'cx-brand' },
                this._el('span', { class: 'cx-brand-mark', text: ' leo'}),
                this._el('div', { class: 'cx-brand-copy' },
                    this._el('span', { class: 'cx-brand-name', text: 'leo帮你学' }),
                    this._el('span', { class: 'cx-ver', text: 'v1.0' }),
                    this._el('button', {
                        id: 'contact-developer', class: 'cx-contact', type: 'button',
                        title: '查看开发者联系二维码', 'aria-label': '查看开发者联系二维码',
                        text: '联系开发者'
                    })
                )
            ),
            this._el('div', { class: 'cx-header-actions' },
                this._el('button', { id: 'btn-collapse', title: '折叠/展开', text: '−' })
            )
        ));

        const body = this._el('div', { id: 'cx-body', class: 'cx-body' });

        body.appendChild(this._el('div', { class: 'cx-status', id: 'cx-status-wrap' },
            this._el('i', { class: 'cx-dot' }),
            this._el('span', { id: 'cx-status', text: '就绪' })
        ));

        // 课程任务
        body.appendChild(this._el('div', { class: 'cx-section first' },
            this._el('div', { class: 'cx-label', text: '课程任务' }),
            this._el('div', { class: 'cx-field', style: 'display:flex; align-items:center; gap:8px;' },
                this._el('input', {
                    id: 'done-pct', type: 'number', class: 'cx-input',
                    min: '10', max: '100', step: '5',
                    style: 'width:70px; flex:none;', placeholder: '90'
                }),
                this._el('span', { style: 'font-size:11px; color:#6B7280;', text: '% 播完即完成跳转' })
            ),
            this._el('button', { id: 'btn-learn-toggle', class: 'cx-btn cx-btn-primary', text: '开始刷课' }),
            this._el('div', { class: 'cx-hint', text: '原速静音播放，测验按设置处理' })
        ));

        // 行为设置
        const anti = this._el('div', { class: 'cx-section', id: 'anti-section' });
        anti.appendChild(this._labelRow('行为设置', null));
        anti.appendChild(this._switchRow('超强隐藏模式', 'stealth-mode', 'font-size:12px; font-weight:600; color:#4F46E5;'));
        anti.appendChild(this._el('div', { class: 'cx-hint', style: 'text-align:left; line-height:1.6;', text: '✅ 降低风控概率：达标延迟完成、章节随机延迟、答题随机节奏、右偏完成分布、随机失焦+低频长休息、起步延迟、防多开锁' }));
        anti.appendChild(this._el('div', { class: 'cx-hint', style: 'text-align:left; line-height:1.6;', text: '⚠️ 取舍：刷课效率下降（预计总耗时 +15~40%）' }));
        anti.appendChild(this._el('div', { class: 'cx-hint', style: 'text-align:left; line-height:1.6;', text: '关闭时一切行为与普通模式完全一致' }));
        anti.appendChild(this._switchRow('随机完成进度', 'rnd-done'));
        anti.appendChild(this._el('div', { class: 'cx-hint', id: 'rnd-done-hint', text: '开启后本次阈值随机取 91~100%' }));
        anti.appendChild(this._switchRow('随机失焦模拟', 'rnd-blur'));
        anti.appendChild(this._el('div', { class: 'cx-hint', id: 'rnd-blur-hint', text: '模拟真人切出窗口：单次 1~30 分钟（平均 3 分钟），平均约 15 分钟一次' }));
        anti.appendChild(this._switchRow('暴力模式（视频弹题）', 'brutal-mode', 'font-size:12px; font-weight:600; color:#4F46E5;'));
        anti.appendChild(this._el('div', { class: 'cx-hint', style: 'text-align:left; line-height:1.6;', text: '判断/单选：枚举随机试选项直到答对；多选：仍只 AI 一次，失败跳下一节；AI+暴力都关：弹题直接下一节' }));
        body.appendChild(anti);

        // AI 答题设置
        const ai = this._el('div', { class: 'cx-section', id: 'ai-section' });
        ai.appendChild(this._labelRow('AI 答题设置', 'ai-enabled'));
        ai.appendChild(this._el('div', { style: 'margin-bottom:6px;' },
            this._el('a', {
                id: 'ai-tutorial',
                href: 'https://my.feishu.cn/wiki/YiCWwggBNiBBGgkOWHZc05Jk6Qh?from=from_copylink',
                target: '_blank', rel: 'noopener noreferrer',
                style: 'font-size:11px; color:#4F46E5; text-decoration:none;',
                text: '配置教程 ↗'
            })
        ));
        const aiFields = this._el('div', { id: 'ai-fields', style: 'display:none;' },
            this._el('input', { id: 'ai-base', class: 'cx-input cx-field', placeholder: 'url' }),
            this._el('input', { id: 'ai-key', type: 'password', class: 'cx-input cx-field', placeholder: 'API Key' }),
            this._el('input', { id: 'ai-model', class: 'cx-input cx-field', placeholder: '模型id' }),
            this._el('div', { class: 'cx-two' },
                this._el('button', { id: 'btn-ai-save', class: 'cx-btn cx-btn-soft', text: '保存设置' }),
                this._el('button', { id: 'btn-ai-run', class: 'cx-btn cx-btn-ghost', text: '立即答题' })
            ),
            this._el('div', { id: 'ai-info', class: 'cx-info', text: '未配置' })
        );
        ai.appendChild(aiFields);
        ai.appendChild(this._el('div', { class: 'cx-hint', id: 'ai-off-hint', text: '关闭时跳过测验（原逻辑）' }));
        body.appendChild(ai);

        // 页面题目工具（默认隐藏，按页面检测显示）
        body.appendChild(this._el('div', { class: 'cx-section', id: 'quiz-tools', style: 'display:none;' },
            this._el('div', { class: 'cx-label', text: '页面题目' }),
            this._el('button', { id: 'btn-extract-quiz', class: 'cx-btn cx-btn-ghost', text: '提取本页题目' }),
            this._el('div', { id: 'quiz-info', class: 'cx-info', text: '未提取' })
        ));

        // 本地题库
        const cacheLabel = this._el('div', { class: 'cx-label' },
            this._el('span', { text: '本地题库' }),
            this._el('span', { id: 'cache-count', style: 'font-weight:400;', text: '0 题' })
        );
        body.appendChild(this._el('div', { class: 'cx-section', id: 'cache-section' },
            cacheLabel,
            this._el('button', { id: 'btn-export-cache', class: 'cx-btn cx-btn-ghost', text: '导出题库 CSV' })
        ));

        // 页脚
        body.appendChild(this._el('div', { class: 'cx-footer' },
            this._el('button', { id: 'btn-clear', class: 'cx-btn cx-btn-danger', text: '清空所有数据' })
        ));

        frag.appendChild(body);
        return frag;
    },

    bindEvents: function (div) {
        const get = (id) => div.querySelector(`#${id}`);

        get('btn-collapse').onclick = (e) => { e.stopPropagation(); this.toggleCollapse(div); };
        get('contact-developer').onclick = () => this.showContactQr();
        const contactModal = document.getElementById('cx-contact-modal');
        const closeContact = document.getElementById('cx-contact-close');
        if (closeContact) closeContact.onclick = () => this.hideContactQr();
        if (contactModal) {
            contactModal.addEventListener('click', (e) => {
                if (e.target === contactModal) this.hideContactQr();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && contactModal.classList.contains('on')) this.hideContactQr();
            });
        }
        get('done-pct').onchange = (e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v)) v = 90;
            v = Math.min(100, Math.max(10, v));
            e.target.value = v;
            State.set({ [KEYS.VIDEO_DONE_PCT]: v });
        };
        // 防风控开关
        get('stealth-mode').onchange = (e) => {
            State.set({ [KEYS.STEALTH]: e.target.checked }, () => this.updateState());
        };
        get('rnd-done').onchange = (e) => {
            State.set({ [KEYS.RND_DONE]: e.target.checked }, () => this.updateState());
        };
        get('rnd-blur').onchange = (e) => {
            State.set({ [KEYS.RND_BLUR]: e.target.checked }, () => this.updateState());
        };
        get('brutal-mode').onchange = (e) => {
            State.set({ [KEYS.BRUTAL]: e.target.checked }, () => this.updateState());
        };

        get('btn-learn-toggle').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            State.get(m => {
                const turningOn = !m[KEYS.IS_LEARN_RUNNING];
                // 每次"开始刷课"重置入口定位（进页面 / 停后重开都会先定位未完成章节）
                if (turningOn && typeof EntryJump !== 'undefined') {
                    EntryJump._done = false;
                    try { State.set({ cx_empty_streak: 0 }); } catch (e) {}
                }
                State.set({
                    [KEYS.IS_LEARN_MODE]: true,
                    [KEYS.IS_LEARN_RUNNING]: turningOn
                }, () => this.updateState());
            });
        });

        get('btn-extract-quiz').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            if (typeof Quiz === 'undefined') { alert("测验模块未加载"); return; }
            const questions = Quiz.extract();
            if (questions.length === 0) { alert("当前页面未发现题目"); return; }
            const forStore = questions.map(q => ({
                title: q.title, options: q.options, answer: q.answer,
                status: q.status, titleEncrypted: q.titleEncrypted
            }));
            State.set({ [KEYS.QUIZ_QUESTIONS]: forStore }, () => {
                get('quiz-info').innerText = `已提取 ${forStore.length} 题（本地保存）`;
            });
        });

        // ---- AI 设置 ----
        const aiEnabled = get('ai-enabled');
        const aiFields = get('ai-fields');
        // 用户编辑中的 AI 字段不再被 updateState 回填（支持改 Key：清空后不会被 storage 立刻填满）
        ['ai-base', 'ai-key', 'ai-model'].forEach(id => {
            const el = get(id);
            if (!el) return;
            const mark = () => { UI._aiTouched[id] = true; };
            el.addEventListener('focus', mark);
            el.addEventListener('input', mark);
            el.addEventListener('change', mark);
        });
        aiEnabled.onchange = () => {
            aiFields.style.display = aiEnabled.checked ? 'block' : 'none';
            State.set({ [KEYS.AI_ENABLED]: aiEnabled.checked }, () => this.updateState());
        };
        get('btn-ai-save').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            const base = get('ai-base').value.trim();
            const model = get('ai-model').value.trim();
            const key = get('ai-key').value.trim().replace(/^Bearer\s+/i, '').trim();
            if (!base || !model || !key) { get('ai-info').innerText = "请填写 url / API Key / 模型id"; return; }
            if (!/^https?:\/\//i.test(base)) {
                get('ai-info').innerText = "url 需以 http(s):// 开头";
                return;
            }
            State.set({
                [KEYS.AI_BASE_URL]: base,
                [KEYS.AI_API_KEY]: key,
                [KEYS.AI_MODEL]: model,
                // 用户主动保存视为已配置，避免再次被预设清理逻辑误伤
                [KEYS.AI_PRESET_CLEANED]: true
            }, () => {
                UI._aiTouched = {};
                get('ai-info').innerText = "已保存 · 仅存本地";
            });
        });
        get('btn-ai-run').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            if (typeof Quiz !== 'undefined' && Quiz.isQuizPage()) {
                if (typeof AIBrain !== 'undefined') AIBrain.run({ force: true });
            } else {
                document.querySelectorAll('iframe').forEach(f => {
                    try { f.contentWindow.postMessage({ action: 'QUIZ_START' }, '*'); } catch (e) {}
                });
            }
        });

        get('btn-clear').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            if (confirm("确定要清空所有数据吗？")) {
                State.set({
                    [KEYS.IS_LEARN_RUNNING]: false,
                    [KEYS.QUIZ_QUESTIONS]: [],
                    [KEYS.AI_CACHE]: []
                }, () => {
                    get("quiz-info").innerText = "未提取";
                    this.updateState(); alert("缓存已清空");
                });
            }
        });

        get('btn-export-cache').onclick = () => this.ensureAgreed(ok => {
            if (!ok) return;
            this.exportCache();
        });
    },

    toggleCollapse: function (div) {
        const body = div.querySelector("#cx-body");
        const btn = div.querySelector("#btn-collapse");
        if (body.style.display === "none") {
            body.style.display = "block";
            btn.innerText = "−";
        } else {
            body.style.display = "none";
            btn.innerText = "+";
        }
    },

    makeDraggable: function (element) {
        const header = element.querySelector("#cx-header");
        let isDragging = false, startX, startY, initialLeft, initialTop;

        header.addEventListener("mousedown", (e) => {
            if (e.target.closest('#btn-collapse, #contact-developer')) return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left; initialTop = rect.top;
            element.style.right = "auto"; element.style.bottom = "auto";
            element.style.left = initialLeft + "px"; element.style.top = initialTop + "px";
            e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            element.style.left = (initialLeft + (e.clientX - startX)) + "px";
            element.style.top = (initialTop + (e.clientY - startY)) + "px";
        });
        document.addEventListener("mouseup", () => isDragging = false);
    },

    /** 生成题库 CSV（带 BOM，Excel 直接打开不乱码） */
    buildCacheCsv: function (list) {
        const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const rows = [['题目', '选项A', '选项B', '选项C', '选项D', '选项E', '答案']];
        (list || []).forEach(x => {
            const opts = (x.options || []).slice(0, 5);
            while (opts.length < 5) opts.push('');
            rows.push([x.title, ...opts, x.answer || '']);
        });
        return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
    },

    exportCache: function () {
        State.get(m => {
            const list = Array.isArray(m[KEYS.AI_CACHE]) ? m[KEYS.AI_CACHE] : [];
            if (list.length === 0) { alert('题库缓存为空，先运行 AI 答题'); return; }
            const csv = this.buildCacheCsv(list);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '学习通题库.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        });
    },

    /** ---- 悬浮进度胶囊 ---- */
    setCapsuleProgress: function (pct, videoState) {
        const el = document.getElementById('cx-capsule');
        const txt = document.getElementById('cx-capsule-text');
        if (!el || !txt) return;
        if (this._capsuleHideTimer) { clearTimeout(this._capsuleHideTimer); this._capsuleHideTimer = null; }
        txt.innerText = '视频 ' + pct + '%';
        el.classList.remove('done');
        el.style.display = 'inline-block';
        this._capsuleVisible = true;
        this._capsuleLastAt = Date.now();

        // 同步更新隐藏模式状态胶囊
        this._setBlurStatus(videoState);
    },

    /** 隐藏模式状态：off=未启用(隐藏) / wait=已启用未到时机(小胶囊) / active=失焦(全屏提示展开) */
    _setBlurStatus: function (state) {
        const bs = document.getElementById('cx-blur-status');
        const ov = document.getElementById('cx-blur-overlay');
        if (!bs || !ov) return;
        if (!state || !state.stealthOn) {
            bs.style.display = 'none';
            this._hideBlurOverlay();
            return;
        }
        if (state.blurred) {
            // 失焦中：小胶囊收起 → 全屏压暗提示"展开"而来
            bs.style.display = 'none';
            this._blurCountBase = state.blurRemain > 0
                ? { remain: state.blurRemain, at: Date.now() }
                : null;
            if (!ov.classList.contains('on')) {
                // 强制重排以重置展开动画
                void ov.offsetWidth;
                ov.classList.add('on');
                const cnt = document.getElementById('cx-blur-count');
                if (cnt && this._blurCountBase) cnt.innerText = '--:--';
            }
        } else {
            bs.innerText = '隐藏模式 · 未到生效时机';
            bs.classList.remove('active');
            bs.style.display = 'inline-block';
            this._hideBlurOverlay();
        }
    },

    _hideBlurOverlay: function () {
        const ov = document.getElementById('cx-blur-overlay');
        if (ov && ov.classList.contains('on')) {
            ov.classList.remove('on');
            this._blurCountBase = null;
        }
    },

    capsuleDone: function () {
        const el = document.getElementById('cx-capsule');
        const txt = document.getElementById('cx-capsule-text');
        if (!el || !txt) return;
        if (this._capsuleHideTimer) clearTimeout(this._capsuleHideTimer);
        txt.innerText = '视频 ✓ 完成';
        el.classList.add('done');
        el.style.display = 'inline-block';
        this._capsuleVisible = true;
        this._capsuleLastAt = Date.now();
        // 任务完成后收起状态胶囊与全屏失焦提示
        const bsDone = document.getElementById('cx-blur-status');
        if (bsDone) bsDone.style.display = 'none';
        this._hideBlurOverlay();
        this._capsuleHideTimer = setTimeout(() => this.hideCapsule(), 2500);
    },

    hideCapsule: function () {
        const el = document.getElementById('cx-capsule');
        if (el) el.style.display = 'none';
        const bsHide = document.getElementById('cx-blur-status');
        if (bsHide) bsHide.style.display = 'none';
        this._hideBlurOverlay();
        this._capsuleVisible = false;
        if (this._capsuleHideTimer) { clearTimeout(this._capsuleHideTimer); this._capsuleHideTimer = null; }
    },

    updateState: function () {
        State.get(m => {
            const btnLearn = document.querySelector("#btn-learn-toggle");
            const status = document.querySelector("#cx-status");
            const statusWrap = document.querySelector("#cx-status-wrap");
            const quizTools = document.querySelector("#quiz-tools");
            if (!btnLearn) return;

            if (m[KEYS.IS_LEARN_RUNNING]) {
                btnLearn.innerText = "停止刷课";
                btnLearn.className = "cx-btn cx-btn-ghost";
                status.innerText = "运行中";
                status.style.color = "#4F46E5";
                if (statusWrap) statusWrap.classList.add('on');
            } else {
                btnLearn.innerText = "开始刷课";
                btnLearn.className = "cx-btn cx-btn-primary";
                status.innerText = "就绪";
                status.style.color = "";
                if (statusWrap) statusWrap.classList.remove('on');
                this.hideCapsule(); // 停止刷课时收起进度胶囊
            }

            // 智慧树平台：隐藏学习通专属功能区（AI/防风控/题库/测验）
            const zhs = typeof Platform !== 'undefined' && Platform.isZhs();
            if (zhs) {
                ['ai-section', 'anti-section', 'cache-section', 'quiz-tools'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
            }

            // 测验工具：学习通页面检测到题目时显示
            if (quizTools && !zhs) {
                const hasQuiz = document.querySelector(".TiMu, .questionLi, .singleQuesId") !== null;
                quizTools.style.display = hasQuiz ? "block" : "none";
            }

            if (m[KEYS.QUIZ_QUESTIONS] && m[KEYS.QUIZ_QUESTIONS].length > 0) {
                const qi = document.querySelector("#quiz-info");
                if (qi) qi.innerText = `已提取 ${m[KEYS.QUIZ_QUESTIONS].length} 题（本地保存）`;
            }

            // AI 设置回填
            const aiChk = document.querySelector("#ai-enabled");
            if (aiChk && aiChk.checked !== !!m[KEYS.AI_ENABLED]) {
                aiChk.checked = !!m[KEYS.AI_ENABLED];
                const fields = document.querySelector("#ai-fields");
                if (fields) fields.style.display = aiChk.checked ? 'block' : 'none';
            }
            const aiOffHint = document.querySelector("#ai-off-hint");
            if (aiOffHint) aiOffHint.style.display = m[KEYS.AI_ENABLED] ? 'none' : 'block';
            // AI 配置回填：空字段显示占位符；历史 OpenAI 官方预设做一次性清理（与 AIBrain.getConfig 一致）
            let baseVal = (m[KEYS.AI_BASE_URL] || '').trim();
            let modelVal = (m[KEYS.AI_MODEL] || '').trim();
            if (!m[KEYS.AI_PRESET_CLEANED]) {
                const LEGACY = (typeof AIBrain !== 'undefined' && AIBrain.LEGACY_PRESET)
                    ? AIBrain.LEGACY_PRESET
                    : { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
                const strip = { [KEYS.AI_PRESET_CLEANED]: true };
                if (baseVal === LEGACY.baseUrl) { strip[KEYS.AI_BASE_URL] = ''; baseVal = ''; }
                if (modelVal === LEGACY.model) { strip[KEYS.AI_MODEL] = ''; modelVal = ''; }
                State.set(strip);
            }
            // 回填空字段；用户已点选/输入过的字段保持手改内容（改 Key 时清空不会被立刻填回）
            const aiBase = document.querySelector("#ai-base");
            const aiKey = document.querySelector("#ai-key");
            const aiModel = document.querySelector("#ai-model");
            const touched = (id) => !!(this._aiTouched && this._aiTouched[id]);
            if (aiBase && !aiBase.value && !touched('ai-base')) aiBase.value = baseVal;
            if (aiKey && !aiKey.value && !touched('ai-key')) aiKey.value = (m[KEYS.AI_API_KEY] || '').trim();
            if (aiModel && !aiModel.value && !touched('ai-model')) aiModel.value = modelVal;
            const aiInfo = document.querySelector("#ai-info");
            if (aiInfo && m[KEYS.AI_API_KEY]) {
                const modelPart = modelVal ? " · " + modelVal : "";
                aiInfo.innerText = (m[KEYS.AI_ENABLED] ? "已启用" : "已配置") + modelPart;
            }

            // 完成进度阈值回填 + 防风控联动（智慧树默认 100：播完即完成）
            const dp = document.querySelector("#done-pct");
            const zhsPlat = typeof Platform !== 'undefined' && Platform.isZhs();
            if (dp && !dp.value) dp.value = m[KEYS.VIDEO_DONE_PCT] || (zhsPlat ? 100 : 90);
            const stealth = !!m[KEYS.STEALTH];
            const sm = document.querySelector("#stealth-mode");
            if (sm) sm.checked = stealth;
            const brutal = !!m[KEYS.BRUTAL];
            const bm = document.querySelector("#brutal-mode");
            if (bm) bm.checked = brutal;
            const rd = document.querySelector("#rnd-done");
            const rb = document.querySelector("#rnd-blur");
            // 超强模式接管两个子开关：强制勾选并禁用
            if (rd) {
                rd.checked = stealth ? true : !!m[KEYS.RND_DONE];
                rd.disabled = stealth;
            }
            if (rb) {
                rb.checked = stealth ? true : !!m[KEYS.RND_BLUR];
                rb.disabled = stealth;
            }
            const rdHint = document.querySelector("#rnd-done-hint");
            if (rdHint) rdHint.innerText = stealth ? '由超强隐藏模式接管（右偏分布 91~100%）' : '开启后本次阈值随机取 91~100%';
            const rbHint = document.querySelector("#rnd-blur-hint");
            if (rbHint) rbHint.innerText = stealth ? '由超强隐藏模式接管（含低频长休息）' : '模拟真人不定时切出窗口：短失焦频繁、长失焦罕见，单次上限 30 分钟';
            if (dp) {
                // 随机进度或超强模式开启时固定输入置灰不可操作
                dp.disabled = stealth || !!m[KEYS.RND_DONE];
                dp.title = dp.disabled ? '已启用随机完成进度，固定值暂不可用' : '';
            }

            // 题库缓存计数
            const cc = document.querySelector("#cache-count");
            if (cc) {
                const n = Array.isArray(m[KEYS.AI_CACHE]) ? m[KEYS.AI_CACHE].length : 0;
                cc.innerText = n + ' 题';
            }
        });
    },

    restoreState: function () { this.updateState(); }
};

// quiz.js - 测验识别与题目提取
// 结构依据：
//  1) work 测验页：singleQuesId/TiMu（学生学习页面测验 → work iframe）
//  2) 视频内弹题：ans-videoquiz / tkItem（视频弹题样本：播放器帧 overlay）

const Quiz = {
    // 超星测验页面选择器：新版 singleQuesId/TiMu/fontLabel 为主，旧版结构兜底
    TITLE_SELECTORS: ['.fontLabel', '.Zy_TItle .clearfix', 'h3.mark_name', '.paperTitle h3'],
    QUESTION_SELECTORS: '.singleQuesId, .TiMu, .questionLi, [id^="question"][data]',

    // 视频内弹题（InteractiveQuiz / videojs ans-videoquiz）
    VIDEO_QUIZ_SELECTOR: '.ans-videoquiz',
    VIDEO_ITEM_SELECTOR: '.tkItem',

    _isVisible: function (el) {
        if (!el) return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return el.offsetHeight > 0 || el.getBoundingClientRect().height > 0;
        } catch (e) {
            return el.offsetHeight > 0;
        }
    },

    isVideoQuizPresent: function () {
        return document.querySelector(Quiz.VIDEO_QUIZ_SELECTOR) !== null;
    },

    /** 视频弹题是否正展示（供播放器暂停/恢复判断） */
    isVideoQuizVisible: function () {
        return Quiz._isVisible(document.querySelector(Quiz.VIDEO_QUIZ_SELECTOR));
    },

    /** 当前视频弹题题型：'tf' | 'single' | 'multi' | null */
    getVideoQuizType: function () {
        const container = document.querySelector(Quiz.VIDEO_QUIZ_SELECTOR);
        if (!container || !Quiz._isVisible(container)) return null;
        const titleEl = container.querySelector('.tkTopic_title');
        const title = titleEl ? titleEl.innerText.trim() : '';
        if (/多选/.test(title)) return 'multi';
        if (/判断/.test(title)) return 'tf';
        if (/单选|选择/.test(title)) return 'single';
        const item = container.querySelector('.tkItem') ||
            [...container.querySelectorAll(Quiz.VIDEO_ITEM_SELECTOR)].find(el => Quiz._isVisible(el));
        const n = item ? item.querySelectorAll('li.ans-videoquiz-opt, .ans-videoquiz-opt').length : 0;
        return n > 2 ? 'single' : 'tf';
    },

    /** 当前展示中的视频弹题题目节点 */
    getVisibleVideoItem: function () {
        const container = document.querySelector(Quiz.VIDEO_QUIZ_SELECTOR);
        if (!container) return null;
        const items = [...container.querySelectorAll(Quiz.VIDEO_ITEM_SELECTOR)];
        const item = items.find(el => Quiz._isVisible(el)) || items[0];
        return item || null;
    },

    /**
     * 视频弹题失败/跳过：强制进入下一节（无视视频任务是否完成）
     * 从播放器帧 postMessage 到顶层，由顶层点击「下一节」
     */
    skipVideoQuizToNext: function (reason) {
        try { State.set({ [KEYS.QUIZ_DONE_FLAG]: true }); } catch (e) {}
        toast('⏭️ ' + (reason || '视频弹题，进入下一节'));
        try {
            window.top.postMessage({ action: 'NEXT_CHAPTER' }, '*');
        } catch (e) {}
    },

    _extractVideoQuestions: function (list) {
        document.querySelectorAll(Quiz.VIDEO_QUIZ_SELECTOR).forEach(container => {
            container.querySelectorAll(Quiz.VIDEO_ITEM_SELECTOR).forEach(item => {
                // 只处理当前展示的题（多题弹窗里其余 tkItem 可能隐藏）
                if (!Quiz._isVisible(item)) return;
                const titleEl = item.querySelector('.tkItem_title, .ans-videoquiz-title');
                let title = titleEl ? titleEl.innerText.replace(/\n/g, '').trim() : '';
                if (!title) return;

                const options = [];
                item.querySelectorAll('li.ans-videoquiz-opt, .ans-videoquiz-opt').forEach((li, idx) => {
                    let t = (li.innerText || '').replace(/\n/g, '').trim()
                        .replace(/^[A-Z][\.\s、]*/, '');
                    // 无字母前缀时按序号补 A/B/C…
                    if (!t) t = String.fromCharCode(65 + idx);
                    options.push(t);
                });

                // 已作答：spanHas/spanNot 展示，或 radio/label 处于选中态
                let answer = '';
                let status = '待定';
                const hasEl = container.querySelector('#spanHas, .spanHas');
                const notEl = container.querySelector('#spanNot, #spanNotBack, .spanNot, .spanNotBack');
                const hasShown = hasEl && Quiz._isVisible(hasEl);
                const notShown = notEl && Quiz._isVisible(notEl);
                const picked = item.querySelector('input[type=radio]:checked, .tkRadio.on, li.ans-videoquiz-opt.on, li.ans-videoquiz-opt.checked, .ans-videoquiz-opt.on');
                if (hasShown) status = '正确';
                else if (notShown) status = '错误';
                if (picked) {
                    const lis = [...item.querySelectorAll('li.ans-videoquiz-opt, .ans-videoquiz-opt')];
                    const i = lis.indexOf(picked.closest('li') || picked);
                    if (i >= 0) answer = String.fromCharCode(65 + i);
                }
                if (hasShown || notShown || answer) {
                    // 已出结果视为已有答案，避免重复请求模型
                    if (!answer) answer = hasShown ? 'A' : 'B';
                }

                list.push({
                    title,
                    options,
                    answer,
                    status,
                    titleEncrypted: false,
                    el: item,
                    kind: 'video'
                });
            });
        });
    },

    // 提取当前帧内的所有题目，返回 [{title, options:[...], answer, status, titleEncrypted, kind, el}]
    extract: () => {
        const list = [];

        // ---- work 测验页 ----
        const all = [...document.querySelectorAll(Quiz.QUESTION_SELECTORS)];
        const nodes = all.filter(n => !all.some(m => m !== n && m.contains(n)));
        nodes.forEach(q => {
            let title = "";
            for (const sel of Quiz.TITLE_SELECTORS) {
                const el = q.querySelector(sel);
                if (el) { title = el.innerText; break; }
            }
            title = title.replace(/\n/g, "").trim();
            if (!title) return;

            const titleEncrypted = !!q.querySelector('.fontLabel.font-cxsecret, .font-cxsecret.fontLabel, .Zy_TItle .font-cxsecret');

            const options = [];
            q.querySelectorAll('li, .answerBg').forEach(el => {
                const aAfter = el.querySelector('a.after');
                const pDiv = el.querySelector('.answer_p, .answerContent, p');
                let t = "";
                if (aAfter) t = aAfter.innerText;
                else if (pDiv) t = pDiv.innerText;
                else t = el.innerText;
                t = t.replace(/\n/g, "").trim().replace(/^[A-Z][\.\s、]*/, "");
                if (t) options.push(t);
            });

            let answer = "";
            const ansEl = q.querySelector('.myAnswerBx .answerCon, .myAnswer .answerCon, .rightAnswerContent, .answerResult');
            if (ansEl) {
                answer = ansEl.innerText.replace("我的答案：", "").replace("正确答案[:：]", "").trim();
            }

            let status = "待定";
            if (q.querySelector('.marking_dui') || q.innerText.includes("✅")) status = "正确";
            else if (q.querySelector('.marking_cuo') || q.innerText.includes("❌")) status = "错误";

            list.push({ title, options, answer, status, titleEncrypted, el: q, kind: 'work' });
        });

        // ---- 视频内弹题 ----
        Quiz._extractVideoQuestions(list);

        return list;
    },

    // 判断当前帧是否是测验页（work 页或视频弹题已挂载）
    isQuizPage: () =>
        document.querySelector(Quiz.QUESTION_SELECTORS) !== null ||
        Quiz.isVideoQuizPresent()
};

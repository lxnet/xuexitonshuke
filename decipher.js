// decipher.js - font-cxsecret 题干解密（字形模板匹配，完全离线）
// 原理：超星把题干码点替换后用内嵌字体还原字形；我们解析该字体的 cmap/glyf，
//       将每个乱码字形与系统字体渲染的 GB2312 常用字做像素 IoU 匹配。
const Decipher = {
    _state: null,          // false = 本页无字体；对象 = 已解析
    _size: 64,
    _tmpSize: 96,

    available: function () { return !!this._ensure(); },

    _findFontBase64: function () {
        const re = /font-family:\s*'font-cxsecret'[\s\S]{0,300}?base64,([A-Za-z0-9+/=]+)/;
        for (const s of document.querySelectorAll('style')) {
            const m = re.exec(s.textContent || '');
            if (m) return m[1];
        }
        return null;
    },

    _ensure: function () {
        if (this._state !== null) return this._state || null;
        const b64 = this._findFontBase64();
        if (!b64) { this._state = false; return null; }
        try {
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            this._state = this._parseTTF(buf.buffer);
            console.log(`[Decipher] 字体解析成功：${this._state.entries.length} 个加密码点`);
        } catch (e) {
            console.warn('[Decipher] 字体解析失败:', e);
            this._state = false;
        }
        return this._state || null;
    },

    /** 解析 TTF：cmap(format4) 码点表 + loca/glyf 轮廓 */
    _parseTTF: function (ab) {
        const dv = new DataView(ab);
        const numTables = dv.getUint16(4);
        const tables = {};
        for (let i = 0; i < numTables; i++) {
            const o = 12 + i * 16;
            const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
            tables[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
        }
        if (!tables.cmap || !tables.loca || !tables.glyf || !tables.head || !tables.maxp) {
            throw new Error('缺少必要字体表');
        }

        // cmap format4
        const cmapOff = tables.cmap.off;
        const nSub = dv.getUint16(cmapOff + 2);
        let sub = -1;
        for (let i = 0; i < nSub; i++) {
            const o = cmapOff + 4 + i * 8;
            const fmt = dv.getUint16(cmapOff + dv.getUint32(o + 4));
            if (fmt === 4) { sub = cmapOff + dv.getUint32(o + 4); break; }
        }
        if (sub < 0) throw new Error('无 format4 cmap');
        const segCount = dv.getUint16(sub + 6) / 2;
        const endO = sub + 14, startO = endO + segCount * 2 + 2;
        const deltaO = startO + segCount * 2, rangeO = deltaO + segCount * 2;
        const entries = [];
        for (let s = 0; s < segCount; s++) {
            const end = dv.getUint16(endO + s * 2);
            const start = dv.getUint16(startO + s * 2);
            const delta = dv.getInt16(deltaO + s * 2);
            const range = dv.getUint16(rangeO + s * 2);
            if (start === 0xFFFF) continue;
            for (let c = start; c <= end && c <= 0xFFFF; c++) {
                let gid;
                if (range === 0) gid = (c + delta) & 0xFFFF;
                else {
                    const gi = rangeO + s * 2 + range + (c - start) * 2;
                    gid = dv.getUint16(gi);
                    if (gid !== 0) gid = (gid + delta) & 0xFFFF;
                }
                if (gid !== 0) entries.push({ code: c, gid });
            }
        }

        // loca / glyf
        const numGlyphs = dv.getUint16(tables.maxp.off + 4);
        const longLoca = dv.getInt16(tables.head.off + 50) !== 0;
        const locaOff = tables.loca.off;
        const locas = [];
        for (let g = 0; g <= numGlyphs; g++) {
            locas.push(longLoca ? dv.getUint32(locaOff + g * 4) : dv.getUint16(locaOff + g * 2) * 2);
        }
        const glyfOff = tables.glyf.off;
        const glyphCache = new Map();
        const readGlyph = (gid) => {
            if (glyphCache.has(gid)) return glyphCache.get(gid);
            let result = null;
            try {
                const gs = glyfOff + locas[gid], ge = glyfOff + locas[gid + 1];
                if (ge > gs) {
                    const nContours = dv.getInt16(gs);
                    if (nContours >= 0) result = this._parseSimpleGlyph(dv, gs, nContours);
                }
            } catch (e) {}
            glyphCache.set(gid, result);
            return result;
        };

        return { entries, readGlyph, codeSet: new Set(entries.map(e => e.code)), glyphCache };
    },

    _parseSimpleGlyph: function (dv, off, nContours) {
        let p = off + 10;
        const endPts = [];
        for (let i = 0; i < nContours; i++) { endPts.push(dv.getUint16(p)); p += 2; }
        const nPts = endPts[endPts.length - 1] + 1;
        const instrLen = dv.getUint16(p); p += 2 + instrLen;
        const flags = [];
        while (flags.length < nPts) {
            const f = dv.getUint8(p++);
            flags.push(f);
            if (f & 8) { const rep = dv.getUint8(p++); for (let k = 0; k < rep; k++) flags.push(f); }
        }
        const xs = []; let x = 0;
        for (let i = 0; i < nPts; i++) {
            const f = flags[i];
            if (f & 2) { const d = dv.getUint8(p++); x += (f & 16) ? d : -d; }
            else if (!(f & 16)) { x += dv.getInt16(p); p += 2; }
            xs.push(x);
        }
        const ys = []; let y = 0;
        for (let i = 0; i < nPts; i++) {
            const f = flags[i];
            if (f & 4) { const d = dv.getUint8(p++); y += (f & 32) ? d : -d; }
            else if (!(f & 32)) { y += dv.getInt16(p); p += 2; }
            ys.push(y);
        }
        const contours = [];
        let s = 0;
        for (const e of endPts) {
            const pts = [];
            for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
            if (pts.length >= 2) contours.push(pts);
            s = e + 1;
        }
        return contours;
    },

    /** 位图归一化：墨水区域裁剪并缩放到 size×size 二值 mask */
    _fitToMask: function (canvas, size) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const w = canvas.width, h = canvas.height;
        const img = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (img[(y * w + x) * 4 + 3] > 64) {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < minX || maxY < minY) return null;
        const sw = maxX - minX + 1, sh = maxY - minY + 1;
        const out = document.createElement('canvas');
        out.width = out.height = size;
        const octx = out.getContext('2d', { willReadFrequently: true });
        const scale = Math.min(size / sw, size / sh);
        const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
        octx.drawImage(canvas, minX, minY, sw, sh, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
        const od = octx.getImageData(0, 0, size, size).data;
        const mask = new Uint8Array(size * size);
        for (let i = 0; i < size * size; i++) mask[i] = od[i * 4 + 3] > 100 ? 1 : 0;
        return mask;
    },

    /** 字体字形 → mask */
    _glyphToMask: function (contours, size) {
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const c of contours) for (const p of c) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const w = maxX - minX || 1, h = maxY - minY || 1;
        const T = this._tmpSize;
        const c = document.createElement('canvas'); c.width = c.height = T;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const scale = (T - 10) / Math.max(w, h);
        const ox = (T - w * scale) / 2, oy = (T - h * scale) / 2;
        const tx = (p) => [ox + (p.x - minX) * scale, T - (oy + (p.y - minY) * scale)]; // y 翻转
        ctx.fillStyle = '#000';
        for (const pts of contours) {
            this._traceContour(ctx, pts, tx);
        }
        ctx.fill();
        return this._fitToMask(c, size);
    },

    /** TrueType 轮廓描边（on/off-curve 二次贝塞尔，含隐含中点） */
    _traceContour: function (ctx, pts, tx) {
        const n = pts.length;
        let si = pts.findIndex(p => p.on);
        let start;
        if (si < 0) {
            start = { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2, on: true };
            si = -1;
        } else start = pts[si];
        ctx.moveTo(...tx(start));
        let ctrl = null;
        for (let i = 1; i <= n; i++) {
            const p = pts[(si + i) % n];
            if (p.on) {
                if (ctrl) { ctx.quadraticCurveTo(...tx(ctrl), ...tx(p)); ctrl = null; }
                else ctx.lineTo(...tx(p));
            } else {
                if (ctrl) {
                    const mid = { x: (ctrl.x + p.x) / 2, y: (ctrl.y + p.y) / 2, on: true };
                    ctx.quadraticCurveTo(...tx(ctrl), ...tx(mid));
                }
                ctrl = p;
            }
        }
        if (ctrl) ctx.quadraticCurveTo(...tx(ctrl), ...tx(start));
        ctx.closePath();
    },

    /** 参考字符（系统字体）→ mask */
    _charToMask: function (ch, size) {
        const T = this._tmpSize;
        const c = document.createElement('canvas'); c.width = c.height = T;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.font = `80px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimHei", sans-serif`;
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(ch, 8, T - 8);
        return this._fitToMask(c, size);
    },

    _iou: function (a, b) {
        let inter = 0, union = 0;
        for (let i = 0; i < a.length; i++) {
            const va = a[i], vb = b[i];
            if (va | vb) union++;
            if (va & vb) inter++;
        }
        return union === 0 ? 0 : inter / union;
    },

    /**
     * 批量解密多段文本：一次候选字构建，处理题干+全部选项（避免逐段重建的性能开销）
     * @param {string[]} texts
     * @returns {Array<{plain:string,replaced:number,confidence:number,pairs:Array}|null>}
     */
    decryptMany: function (texts) {
        const list = (texts || []).map(t => t || '');
        const st = this._ensure();
        if (!st) return list.map(() => null);

        // 收集全部乱码码点
        const codes = [];
        for (const t of list) {
            for (const ch of t) {
                const c = ch.codePointAt(0);
                if (st.codeSet.has(c) && !codes.includes(c)) codes.push(c);
            }
        }
        if (codes.length === 0) return list.map(() => null);

        // 候选字 masks 只构建一次（本批次共享）
        const size = this._size;
        const cand = [];
        for (const ch of CX_CANDIDATES) {
            const m = this._charToMask(ch, size);
            if (m) cand.push({ ch, m });
        }

        const pairs = [];
        let confSum = 0;
        const mapCode = new Map();
        for (const code of codes) {
            const entry = st.entries.find(e => e.code === code);
            const contours = entry ? st.readGlyph(entry.gid) : null;
            if (!contours) { mapCode.set(code, null); continue; }
            const gm = this._glyphToMask(contours, size);
            if (!gm) { mapCode.set(code, null); continue; }
            let best = null, second = 0;
            for (const cd of cand) {
                const s = this._iou(gm, cd.m);
                if (!best || s > best.s) { second = best ? best.s : 0; best = { ch: cd.ch, s }; }
                else if (s > second) second = s;
            }
            if (best) {
                mapCode.set(code, best.ch);
                confSum += best.s;
                pairs.push({ from: String.fromCodePoint(code), to: best.ch, score: +best.s.toFixed(3), second: +second.toFixed(3) });
            } else mapCode.set(code, null);
        }

        return list.map(text => {
            let replaced = 0;
            let plain = '';
            for (const ch of text) {
                const c = ch.codePointAt(0);
                if (st.codeSet.has(c)) {
                    const mapped = mapCode.get(c);
                    if (mapped) { plain += mapped; replaced++; continue; }
                }
                plain += ch;
            }
            if (replaced === 0) return null;
            return { plain, replaced, confidence: confSum / Math.max(1, pairs.length), pairs };
        });
    },

    /** 单段解密（等价 decryptMany([text])[0]） */
    decrypt: function (text) {
        return this.decryptMany([text || ''])[0];
    }
};

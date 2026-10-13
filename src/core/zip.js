// ========== 极简 ZIP 打包（STORE 无压缩） ==========
// 用于导出「改卷材料包」：records.json + 图片文件，交给本地 AI 分析。
// 不引入第三方依赖，仅实现 STORE 方式（无压缩），图片本身已压缩，体积可控。

const ZipWriter = {
    // CRC32 查表
    _crcTable: null,
    _crc32(bytes) {
        if (!this._crcTable) {
            const t = new Int32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c;
            }
            this._crcTable = t;
        }
        let crc = -1;
        for (let i = 0; i < bytes.length; i++) {
            crc = (crc >>> 8) ^ this._crcTable[(crc ^ bytes[i]) & 0xFF];
        }
        return (crc ^ -1) >>> 0;
    },

    // UTF-8 编码字符串为字节数组
    _utf8(str) {
        return new TextEncoder().encode(str);
    },

    /**
     * 生成 ZIP 文件的 Uint8Array
     * @param {Array<{name: string, data: Uint8Array}>} entries - 文件列表
     * @returns {Uint8Array}
     */
    build(entries) {
        const localParts = [];   // local file header + data
        const centralParts = []; // central directory entries
        let offset = 0;

        for (const entry of entries) {
            const nameBytes = this._utf8(entry.name);
            const data = entry.data;
            const crc = this._crc32(data);
            const size = data.length;

            // Local File Header
            const local = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);  // signature
            lv.setUint16(4, 20, true);          // version needed
            lv.setUint16(6, 0x0800, true);      // general purpose: UTF-8
            lv.setUint16(8, 0, true);           // compression: store
            lv.setUint16(10, 0, true);          // mod time
            lv.setUint16(12, 0x21, true);       // mod date (1980-01-01)
            lv.setUint32(14, crc, true);        // crc32
            lv.setUint32(18, size, true);       // compressed size
            lv.setUint32(22, size, true);       // uncompressed size
            lv.setUint16(26, nameBytes.length, true); // name length
            lv.setUint16(28, 0, true);          // extra length
            local.set(nameBytes, 30);
            localParts.push(local, data);

            // Central Directory Entry
            const central = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);  // signature
            cv.setUint16(4, 20, true);          // version made by
            cv.setUint16(6, 20, true);          // version needed
            cv.setUint16(8, 0x0800, true);      // general purpose: UTF-8
            cv.setUint16(10, 0, true);          // compression: store
            cv.setUint16(12, 0, true);          // mod time
            cv.setUint16(14, 0x21, true);       // mod date
            cv.setUint32(16, crc, true);        // crc32
            cv.setUint32(20, size, true);       // compressed size
            cv.setUint32(24, size, true);       // uncompressed size
            cv.setUint16(28, nameBytes.length, true); // name length
            cv.setUint16(30, 0, true);          // extra length
            cv.setUint16(32, 0, true);          // comment length
            cv.setUint16(34, 0, true);          // disk number start
            cv.setUint16(36, 0, true);          // internal attrs
            cv.setUint32(38, 0, true);          // external attrs
            cv.setUint32(42, offset, true);     // local header offset
            central.set(nameBytes, 46);
            centralParts.push(central);

            offset += local.length + data.length;
        }

        // End of Central Directory
        const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);      // signature
        ev.setUint16(4, 0, true);               // disk number
        ev.setUint16(6, 0, true);               // disk with central dir
        ev.setUint16(8, entries.length, true);  // entries on this disk
        ev.setUint16(10, entries.length, true); // total entries
        ev.setUint32(12, centralSize, true);    // central dir size
        ev.setUint32(16, offset, true);         // central dir offset
        ev.setUint16(20, 0, true);              // comment length

        // 拼接所有部分
        const totalLen = offset + centralSize + 22;
        const out = new Uint8Array(totalLen);
        let pos = 0;
        for (const p of localParts) { out.set(p, pos); pos += p.length; }
        for (const p of centralParts) { out.set(p, pos); pos += p.length; }
        out.set(eocd, pos);
        return out;
    }
};

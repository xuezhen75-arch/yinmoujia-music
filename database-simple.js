/**
 * 音谋加 - 简单数据库模块 (JSON文件存储)
 * 无需安装任何数据库，部署极简
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
const FREE_LIMIT = 5;  // 免费次数
const PRICE_PER_SONG = 0.8;  // 每首收费（元）

function init() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({
            users: {},      // deviceId -> { freeUsed, unlockCodes[], unlockExpiry, balance }
            codes: {},      // code -> { used, usedBy, usedAt, createdAt }
            freeList: []    // 免费名单：[{ deviceId, name, addedAt }]
        }, null, 2));
    }
    // 兼容旧数据：确保 freeList 字段存在
    const db = read();
    if (!db.freeList) { db.freeList = []; write(db); }
    // 兼容旧用户数据：确保 balance 字段存在
    let changed = false;
    for (const id in db.users) {
        if (db.users[id].balance === undefined) { db.users[id].balance = 0; changed = true; }
    }
    if (changed) write(db);
}

function read() {
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        return { users: {}, codes: {} };
    }
}

function write(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// 分享记录存储路径
const SHARE_DB_PATH = path.join(__dirname, 'data', 'shares.json');

function readShares() {
    try {
        if (!fs.existsSync(SHARE_DB_PATH)) return {};
        return JSON.parse(fs.readFileSync(SHARE_DB_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeShares(data) {
    fs.writeFileSync(SHARE_DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
    init,

    // 获取用户配额信息
    getUserQuota(deviceId) {
        const db = read();
        const user = db.users[deviceId] || { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0 };

        const remaining = Math.max(0, FREE_LIMIT - user.freeUsed);
        const isFreeUser = db.freeList.some(f => f.deviceId === deviceId);
        const canGenerate = remaining > 0
            || (user.unlockExpiry && new Date(user.unlockExpiry) > new Date())
            || isFreeUser
            || (user.balance > 0);

        return {
            freeUsed: user.freeUsed,
            freeLimit: FREE_LIMIT,
            remaining: remaining,
            canGenerate,
            unlocked: user.unlockExpiry && new Date(user.unlockExpiry) > new Date(),
            unlockExpiry: user.unlockExpiry,
            balance: user.balance || 0,
            isFreeUser,
            pricePerSong: PRICE_PER_SONG
        };
    },

    // 消耗免费次数或余额
    consumeFree(deviceId) {
        const db = read();
        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0 };
        }

        const isFreeUser = db.freeList.some(f => f.deviceId === deviceId);
        const remaining = Math.max(0, FREE_LIMIT - db.users[deviceId].freeUsed);
        const isUnlocked = db.users[deviceId].unlockExpiry && new Date(db.users[deviceId].unlockExpiry) > new Date();

        // 优先消耗免费次数
        if (remaining > 0) {
            db.users[deviceId].freeUsed++;
        } else if (isFreeUser) {
            // 免费名单用户不扣费
            db.users[deviceId].freeUsed++;
        } else if (isUnlocked) {
            // 解锁用户不扣费
            db.users[deviceId].freeUsed++;
        } else if (db.users[deviceId].balance >= PRICE_PER_SONG) {
            // 扣余额
            db.users[deviceId].balance = Math.round((db.users[deviceId].balance - PRICE_PER_SONG) * 100) / 100;
        } else {
            return null; // 余额不足
        }

        write(db);
        return this.getUserQuota(deviceId);
    },

    // ===== 免费名单管理 =====

    // 获取免费名单
    getFreeList() {
        const db = read();
        return db.freeList || [];
    },

    // 添加免费用户
    addFreeUser(deviceId, name) {
        const db = read();
        if (db.freeList.some(f => f.deviceId === deviceId)) {
            return { success: false, error: '该设备已在免费名单中' };
        }
        db.freeList.push({ deviceId, name: name || deviceId, addedAt: new Date().toISOString() });
        write(db);
        return { success: true };
    },

    // 删除免费用户
    removeFreeUser(deviceId) {
        const db = read();
        const idx = db.freeList.findIndex(f => f.deviceId === deviceId);
        if (idx === -1) return { success: false, error: '未找到该设备' };
        db.freeList.splice(idx, 1);
        write(db);
        return { success: true };
    },

    // 充值余额
    addBalance(deviceId, amount) {
        const db = read();
        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0 };
        }
        db.users[deviceId].balance = Math.round(((db.users[deviceId].balance || 0) + amount) * 100) / 100;
        write(db);
        return { success: true, balance: db.users[deviceId].balance };
    },

    // 获取所有用户列表（管理员）
    getUserList() {
        const db = read();
        return Object.entries(db.users).map(([deviceId, user]) => ({
            deviceId,
            freeUsed: user.freeUsed || 0,
            balance: user.balance || 0,
            unlocked: user.unlockExpiry && new Date(user.unlockExpiry) > new Date(),
            unlockExpiry: user.unlockExpiry
        }));
    },

    // 验证解锁码
    verifyCode(code, deviceId) {
        const db = read();
        const normalizedCode = code.trim().toUpperCase();

        // 检查码是否存在且未使用
        if (!db.codes[normalizedCode]) {
            return { success: false, error: '解锁码无效' };
        }

        const codeData = db.codes[normalizedCode];

        if (codeData.used) {
            return { success: false, error: '该解锁码已被使用' };
        }

        // 检查是否过期
        if (codeData.expiresAt && new Date(codeData.expiresAt) < new Date()) {
            return { success: false, error: '解锁码已过期' };
        }

        // 标记为已使用
        db.codes[normalizedCode].used = true;
        db.codes[normalizedCode].usedBy = deviceId;
        db.codes[normalizedCode].usedAt = new Date().toISOString();

        // 给用户开通权限（默认1年有效期）
        const expiry = codeData.duration || '1y';
        let expiryDate;
        switch (expiry) {
            case '1y': expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000); break;
            case '1m': expiryDate = new Date(Date.now() + 30 * 24 * 3600 * 1000); break;
            case '1w': expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000); break;
            default: expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000);
        }

        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null };
        }
        db.users[deviceId].unlockExpiry = expiryDate.toISOString();
        db.users[deviceId].unlockCodes.push({ code: normalizedCode, usedAt: new Date().toISOString() });

        write(db);
        return { success: true, expiry: expiryDate.toISOString(), message: `解锁成功，有效期至 ${expiryDate.toLocaleDateString('zh-CN')}` };
    },

    // 生成解锁码（管理员接口）
    generateCode(options = {}) {
        const db = read();
        const {
            count = 1,
            prefix = 'YINMJ',
            duration = '1y',    // 1y=1年, 1m=1月, 1w=1周
            expiresIn = 30     // 码本身多少天内有效（天）
        } = options;

        const codes = [];
        const expiresAt = new Date(Date.now() + expiresIn * 24 * 3600 * 1000).toISOString();

        for (let i = 0; i < count; i++) {
            const rand = Math.random().toString(36).substring(2, 6).toUpperCase() +
                        Math.random().toString(36).substring(2, 6).toUpperCase();
            const code = `${prefix}-${rand}`;

            db.codes[code] = {
                used: false,
                usedBy: null,
                usedAt: null,
                createdAt: new Date().toISOString(),
                expiresAt: expiresAt,
                duration: duration
            };
            codes.push(code);
        }

        write(db);
        return { codes, expiresAt, duration };
    },

    // 获取所有未使用的码（管理员）
    getUnusedCodes() {
        const db = read();
        return Object.entries(db.codes)
            .filter(([_, v]) => !v.used)
            .map(([code, v]) => ({ code, ...v }));
    },

    // 统计（管理员）
    getStats() {
        const db = read();
        const usedCodes = Object.values(db.codes).filter(c => c.used).length;
        const totalCodes = Object.keys(db.codes).length;
        const totalUsers = Object.keys(db.users).length;
        const totalGenerations = Object.values(db.users).reduce((sum, u) => sum + (u.freeUsed || 0), 0);
        const freeListCount = (db.freeList || []).length;
        const totalBalance = Object.values(db.users).reduce((sum, u) => sum + (u.balance || 0), 0);

        return { usedCodes, totalCodes, totalUsers, totalGenerations, freeListCount, totalBalance, freeLimit: FREE_LIMIT, pricePerSong: PRICE_PER_SONG };
    },

    // ===== 分享记录 =====

    // 保存分享记录
    saveShareRecord(record) {
        const shares = readShares();
        shares[record.id] = record;
        writeShares(shares);
    },

    // 获取分享记录
    getShareRecord(id) {
        const shares = readShares();
        return shares[id] || null;
    },

    // 增加播放计数
    incrementSharePlays(id) {
        const shares = readShares();
        if (shares[id]) {
            shares[id].plays = (shares[id].plays || 0) + 1;
            writeShares(shares);
        }
    }
};

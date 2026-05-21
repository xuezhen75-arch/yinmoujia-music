/**
 * 音谋加 - 简单数据库模块 (JSON文件存储)
 * v2.3 - 支持昵称登录
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
            users: {},      // deviceId -> { freeUsed, unlockCodes[], unlockExpiry, balance, nickname }
            codes: {},      // code -> { used, usedBy, usedAt, createdAt }
            freeList: []    // 免费名单：[{ nickname, deviceId, addedAt }]
        }, null, 2));
    }
    // 兼容旧数据
    const db = read();
    let changed = false;
    if (!db.freeList) { db.freeList = []; changed = true; }
    // 兼容旧用户数据
    for (const id in db.users) {
        if (db.users[id].balance === undefined) { db.users[id].balance = 0; changed = true; }
        if (db.users[id].nickname === undefined) { db.users[id].nickname = ''; changed = true; }
    }
    // 兼容旧freeList格式（旧的用deviceId，新的用nickname）
    db.freeList.forEach(item => {
        if (!item.nickname && item.name) { item.nickname = item.name; }
        if (!item.nickname && !item.name) { item.nickname = item.deviceId; }
    });
    if (changed) write(db);
}

function read() {
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        return { users: {}, codes: {}, freeList: [] };
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
        const user = db.users[deviceId] || { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0, nickname: '' };

        const remaining = Math.max(0, FREE_LIMIT - user.freeUsed);
        // 按昵称匹配免费名单（优先），也兼容旧的deviceId匹配
        const isFreeUser = db.freeList.some(f =>
            (f.nickname && user.nickname && f.nickname === user.nickname) ||
            f.deviceId === deviceId
        );
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
            pricePerSong: PRICE_PER_SONG,
            nickname: user.nickname || ''
        };
    },

    // 设置/更新用户昵称
    setNickname(deviceId, nickname) {
        const db = read();
        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0, nickname: '' };
        }
        db.users[deviceId].nickname = nickname;
        write(db);
        return true;
    },

    // 消耗免费次数或余额
    consumeFree(deviceId) {
        const db = read();
        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0, nickname: '' };
        }

        const isFreeUser = db.freeList.some(f =>
            (f.nickname && db.users[deviceId].nickname && f.nickname === db.users[deviceId].nickname) ||
            f.deviceId === deviceId
        );
        const remaining = Math.max(0, FREE_LIMIT - db.users[deviceId].freeUsed);
        const isUnlocked = db.users[deviceId].unlockExpiry && new Date(db.users[deviceId].unlockExpiry) > new Date();

        // 优先消耗免费次数
        if (remaining > 0) {
            db.users[deviceId].freeUsed++;
        } else if (isFreeUser) {
            db.users[deviceId].freeUsed++;
        } else if (isUnlocked) {
            db.users[deviceId].freeUsed++;
        } else if (db.users[deviceId].balance >= PRICE_PER_SONG) {
            db.users[deviceId].balance = Math.round((db.users[deviceId].balance - PRICE_PER_SONG) * 100) / 100;
        } else {
            return null; // 余额不足
        }

        write(db);
        return this.getUserQuota(deviceId);
    },

    // ===== 免费名单管理 =====

    getFreeList() {
        const db = read();
        return db.freeList || [];
    },

    // 按昵称添加免费用户
    addFreeUser(nickname) {
        const db = read();
        if (!nickname || !nickname.trim()) {
            return { success: false, error: '请输入昵称' };
        }
        nickname = nickname.trim();
        // 检查是否已存在
        if (db.freeList.some(f => f.nickname === nickname)) {
            return { success: false, error: '该昵称已在免费名单中' };
        }
        db.freeList.push({ nickname, deviceId: '', addedAt: new Date().toISOString() });
        write(db);
        return { success: true };
    },

    // 按昵称删除免费用户
    removeFreeUser(nickname) {
        const db = read();
        const idx = db.freeList.findIndex(f => f.nickname === nickname);
        if (idx === -1) return { success: false, error: '未找到该用户' };
        db.freeList.splice(idx, 1);
        write(db);
        return { success: true };
    },

    // 充值余额（按昵称或deviceId）
    addBalance(identifier, amount) {
        const db = read();
        // 先按昵称找，再按deviceId找
        let targetId = null;
        for (const id in db.users) {
            if (db.users[id].nickname === identifier || id === identifier) {
                targetId = id;
                break;
            }
        }
        if (!targetId) {
            return { success: false, error: '未找到该用户' };
        }
        if (!db.users[targetId]) {
            db.users[targetId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0 };
        }
        db.users[targetId].balance = Math.round(((db.users[targetId].balance || 0) + amount) * 100) / 100;
        write(db);
        return { success: true, balance: db.users[targetId].balance, nickname: db.users[targetId].nickname };
    },

    // 获取所有用户列表（管理员）
    getUserList() {
        const db = read();
        return Object.entries(db.users).map(([deviceId, user]) => ({
            deviceId,
            nickname: user.nickname || '(未设置)',
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

        if (!db.codes[normalizedCode]) {
            return { success: false, error: '解锁码无效' };
        }

        const codeData = db.codes[normalizedCode];

        if (codeData.used) {
            return { success: false, error: '该解锁码已被使用' };
        }

        if (codeData.expiresAt && new Date(codeData.expiresAt) < new Date()) {
            return { success: false, error: '解锁码已过期' };
        }

        db.codes[normalizedCode].used = true;
        db.codes[normalizedCode].usedBy = deviceId;
        db.codes[normalizedCode].usedAt = new Date().toISOString();

        const expiry = codeData.duration || '1y';
        let expiryDate;
        switch (expiry) {
            case '1y': expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000); break;
            case '1m': expiryDate = new Date(Date.now() + 30 * 24 * 3600 * 1000); break;
            case '1w': expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000); break;
            default: expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000);
        }

        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null, balance: 0, nickname: '' };
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
            duration = '1y',
            expiresIn = 30
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

    saveShareRecord(record) {
        const shares = readShares();
        shares[record.id] = record;
        writeShares(shares);
    },

    getShareRecord(id) {
        const shares = readShares();
        return shares[id] || null;
    },

    incrementSharePlays(id) {
        const shares = readShares();
        if (shares[id]) {
            shares[id].plays = (shares[id].plays || 0) + 1;
            writeShares(shares);
        }
    }
};

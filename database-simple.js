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
function init() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({
            users: {},      // deviceId -> { freeUsed, unlockCodes[], unlockExpiry }
            codes: {}       // code -> { used, usedBy, usedAt, createdAt }
        }, null, 2));
    }
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

const FREE_LIMIT = 3;  // 免费次数

module.exports = {
    init,

    // 获取用户配额信息
    getUserQuota(deviceId) {
        const db = read();
        const user = db.users[deviceId] || { freeUsed: 0, unlockCodes: [], unlockExpiry: null };

        const remaining = Math.max(0, FREE_LIMIT - user.freeUsed);
        const canGenerate = remaining > 0 || (user.unlockExpiry && new Date(user.unlockExpiry) > new Date());

        return {
            freeUsed: user.freeUsed,
            freeLimit: FREE_LIMIT,
            remaining: remaining,
            canGenerate,
            unlocked: user.unlockExpiry && new Date(user.unlockExpiry) > new Date(),
            unlockExpiry: user.unlockExpiry
        };
    },

    // 消耗免费次数
    consumeFree(deviceId) {
        const db = read();
        if (!db.users[deviceId]) {
            db.users[deviceId] = { freeUsed: 0, unlockCodes: [], unlockExpiry: null };
        }
        db.users[deviceId].freeUsed++;
        write(db);
        return this.getUserQuota(deviceId);
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

        return { usedCodes, totalCodes, totalUsers, totalGenerations };
    }
};

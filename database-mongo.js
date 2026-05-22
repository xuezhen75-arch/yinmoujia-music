/**
 * 音谋加 - MongoDB 数据库模块
 * v3.0 - 持久化存储，解决 Render 免费版清数据问题
 *
 * 用户标识逻辑：优先按 nickname 查找，未设昵称则按 deviceId
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || '';
const FREE_LIMIT = 3;
const PRICE_PER_SONG = 0.8;

// ============ Schema ============

const UserSchema = new mongoose.Schema({
    userId:     { type: String, required: true, unique: true, index: true },  // 主标识：优先nickname，否则deviceId
    nickname:   { type: String, default: '' },
    deviceIds:  [{ type: String }],  // 关联的所有设备ID
    freeUsed:   { type: Number, default: 0 },
    balance:    { type: Number, default: 0 },
    unlockCodes:[{
        code: String,
        usedAt: Date
    }],
    unlockExpiry: { type: Date, default: null },
    isFreeUser: { type: Boolean, default: false },
}, { timestamps: true });

const GenerationSchema = new mongoose.Schema({
    recordId:    { type: String, required: true, unique: true, index: true },
    userId:      { type: String, required: true, index: true },
    nickname:    { type: String, default: '' },
    mood:        String,
    scene:       String,
    style:       String,
    keyword:     String,
    instrumental:{ type: Boolean, default: false },
    songs:       [{
        index:    Number,
        title:    String,
        audioUrl: String,
        videoUrl: String,
        imageUrl: String,
        lyrics:   String,
    }],
    plays:       { type: Number, default: 0 },
}, { timestamps: true });

const CodeSchema = new mongoose.Schema({
    code:        { type: String, required: true, unique: true },
    used:        { type: Boolean, default: false },
    usedBy:      { type: String, default: null },
    usedAt:      { type: Date, default: null },
    createdAt:   { type: Date, default: Date.now },
    expiresAt:   { type: Date, default: null },
    duration:    { type: String, default: '1y' },
});

const FreeListSchema = new mongoose.Schema({
    nickname:    { type: String, required: true, unique: true },
    deviceId:    { type: String, default: '' },
    addedAt:     { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const Generation = mongoose.model('Generation', GenerationSchema);
const Code = mongoose.model('Code', CodeSchema);
const FreeList = mongoose.model('FreeList', FreeListSchema);

// ============ 连接管理 ============

let connected = false;

// Mongoose 事件：连接断开时自动重连
mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] 连接断开，尝试重连...');
    connected = false;
});
mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] 连接错误:', err.message);
});

async function init() {
    if (!MONGODB_URI) {
        console.warn('[MongoDB] MONGODB_URI 未配置，使用JSON文件兜底');
        return false;
    }
    if (connected) return true;

    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        connected = true;
        console.log('[MongoDB] 连接成功');
        return true;
    } catch (err) {
        console.error('[MongoDB] 连接失败:', err.message);
        return false;
    }
}

// ============ 用户标识解析 ============

/**
 * 解析用户ID：优先按 nickname 查找已有用户
 * 如果 nickname 无记录则用 deviceId
 */
async function resolveUserId(deviceId, nickname) {
    if (nickname && nickname.trim()) {
        const existing = await User.findOne({ nickname: nickname.trim() });
        if (existing) return existing.userId;
    }
    return deviceId;
}

// ============ 用户配额 ============

async function getUserQuota(deviceId, nickname) {
    const userId = await resolveUserId(deviceId, nickname);

    let user = await User.findOne({ userId });
    if (!user) {
        user = new User({ userId, nickname: (nickname || '').trim() });
        await user.save();
    }

    // 同步昵称和deviceId
    let changed = false;
    if (nickname && nickname.trim() && user.nickname !== nickname.trim()) {
        user.nickname = nickname.trim();
        changed = true;
    }
    if (!user.deviceIds.includes(deviceId)) {
        user.deviceIds.push(deviceId);
        changed = true;
    }
    if (changed) await user.save();

    const remaining = Math.max(0, FREE_LIMIT - user.freeUsed);

    // 检查免费名单
    const freeEntry = await FreeList.findOne({
        $or: [
            { nickname: user.nickname },
            { deviceId }
        ]
    });
    const isFreeUser = !!freeEntry;

    const canGenerate = remaining > 0
        || (user.unlockExpiry && new Date(user.unlockExpiry) > new Date())
        || isFreeUser
        || (user.balance > 0);

    return {
        freeUsed: user.freeUsed,
        freeLimit: FREE_LIMIT,
        remaining,
        canGenerate,
        unlocked: !!(user.unlockExpiry && new Date(user.unlockExpiry) > new Date()),
        unlockExpiry: user.unlockExpiry ? user.unlockExpiry.toISOString() : null,
        balance: user.balance,
        isFreeUser,
        pricePerSong: PRICE_PER_SONG,
        nickname: user.nickname || '',
    };
}

async function setNickname(deviceId, nickname) {
    const clean = (nickname || '').trim();
    if (!clean) return false;

    // 查找该昵称是否已有用户
    let user = await User.findOne({ nickname: clean });

    if (user) {
        // 已有该昵称用户，关联此deviceId
        if (!user.deviceIds.includes(deviceId)) {
            user.deviceIds.push(deviceId);
            await user.save();
        }
    } else {
        // 新用户：按 deviceId 找，没有则创建
        user = await User.findOne({ userId: deviceId });
        if (!user) {
            user = new User({ userId: clean, nickname: clean });
        } else {
            // 已有deviceId用户，更新userId为nickname
            user.userId = clean;
            user.nickname = clean;
        }
        if (!user.deviceIds.includes(deviceId)) {
            user.deviceIds.push(deviceId);
        }
        await user.save();
    }
    return true;
}

async function consumeFree(deviceId, nickname) {
    const userId = await resolveUserId(deviceId, nickname);

    let user = await User.findOne({ userId });
    if (!user) {
        user = new User({ userId, nickname: (nickname || '').trim() });
        await user.save();
    }

    const freeEntry = await FreeList.findOne({
        $or: [
            { nickname: user.nickname },
            { deviceId }
        ]
    });
    const isFreeUser = !!freeEntry;
    const remaining = Math.max(0, FREE_LIMIT - user.freeUsed);
    const isUnlocked = user.unlockExpiry && new Date(user.unlockExpiry) > new Date();

    if (remaining > 0 || isFreeUser || isUnlocked) {
        user.freeUsed += 1;
    } else if (user.balance >= PRICE_PER_SONG) {
        user.balance = Math.round((user.balance - PRICE_PER_SONG) * 100) / 100;
    } else {
        return null;
    }

    await user.save();

    return {
        remaining: Math.max(0, FREE_LIMIT - user.freeUsed),
        balance: user.balance,
    };
}

// ============ 免费名单 ============

async function getFreeList() {
    return await FreeList.find().sort({ addedAt: -1 }).lean();
}

async function addFreeUser(nickname) {
    const clean = (nickname || '').trim();
    if (!clean) return { success: false, error: '请输入昵称' };

    const existing = await FreeList.findOne({ nickname: clean });
    if (existing) return { success: false, error: '该昵称已在免费名单中' };

    await new FreeList({ nickname: clean }).save();

    // 同步标记已有用户
    await User.updateOne({ nickname: clean }, { isFreeUser: true });

    return { success: true };
}

async function removeFreeUser(nickname) {
    const result = await FreeList.deleteOne({ nickname: (nickname || '').trim() });
    if (result.deletedCount === 0) return { success: false, error: '未找到该用户' };

    // 同步标记
    await User.updateOne({ nickname: (nickname || '').trim() }, { isFreeUser: false });

    return { success: true };
}

// ============ 余额 ============

async function addBalance(identifier, amount) {
    // 按昵称或deviceId查找
    const user = await User.findOne({
        $or: [
            { nickname: identifier },
            { userId: identifier },
            { deviceIds: identifier }
        ]
    });
    if (!user) return { success: false, error: '未找到该用户' };

    user.balance = Math.round(((user.balance || 0) + amount) * 100) / 100;
    await user.save();

    return { success: true, balance: user.balance, nickname: user.nickname };
}

async function getUserList() {
    const users = await User.find().sort({ updatedAt: -1 }).lean();
    return users.map(u => ({
        deviceId: u.userId,
        nickname: u.nickname || '(未设置)',
        freeUsed: u.freeUsed || 0,
        balance: u.balance || 0,
        unlocked: !!(u.unlockExpiry && new Date(u.unlockExpiry) > new Date()),
        unlockExpiry: u.unlockExpiry ? u.unlockExpiry.toISOString() : null
    }));
}

// ============ 解锁码 ============

async function verifyCode(code, deviceId) {
    const normalized = code.trim().toUpperCase();
    const codeDoc = await Code.findOne({ code: normalized });

    if (!codeDoc) return { success: false, error: '解锁码无效' };
    if (codeDoc.used) return { success: false, error: '该解锁码已被使用' };
    if (codeDoc.expiresAt && new Date(codeDoc.expiresAt) < new Date()) {
        return { success: false, error: '解锁码已过期' };
    }

    codeDoc.used = true;
    codeDoc.usedBy = deviceId;
    codeDoc.usedAt = new Date();
    await codeDoc.save();

    const duration = codeDoc.duration || '1y';
    let expiryDate;
    switch (duration) {
        case '1y': expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000); break;
        case '1m': expiryDate = new Date(Date.now() + 30 * 24 * 3600 * 1000); break;
        case '1w': expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000); break;
        default: expiryDate = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    }

    const user = await User.findOne({ $or: [{ userId: deviceId }, { deviceIds: deviceId }] });
    if (user) {
        user.unlockExpiry = expiryDate;
        user.unlockCodes.push({ code: normalized, usedAt: new Date() });
        await user.save();
    }

    return {
        success: true,
        expiry: expiryDate.toISOString(),
        message: `解锁成功，有效期至 ${expiryDate.toLocaleDateString('zh-CN')}`
    };
}

async function generateCode(options = {}) {
    const { count = 1, prefix = 'YINMJ', duration = '1y', expiresIn = 30 } = options;
    const codes = [];
    const expiresAt = new Date(Date.now() + expiresIn * 24 * 3600 * 1000);

    for (let i = 0; i < count; i++) {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
                   + Math.random().toString(36).substring(2, 6).toUpperCase();
        const code = `${prefix}-${rand}`;
        await new Code({ code, expiresAt, duration }).save();
        codes.push(code);
    }

    return { codes, expiresAt: expiresAt.toISOString(), duration };
}

async function getUnusedCodes() {
    const docs = await Code.find({ used: false }).lean();
    return docs.map(d => ({ code: d.code, ...d, createdAt: d.createdAt?.toISOString(), expiresAt: d.expiresAt?.toISOString() }));
}

// ============ 统计 ============

async function getStats() {
    const totalCodes = await Code.countDocuments();
    const usedCodes = await Code.countDocuments({ used: true });
    const totalUsers = await User.countDocuments();
    const allUsers = await User.find().lean();
    const totalGenerations = allUsers.reduce((s, u) => s + (u.freeUsed || 0), 0);
    const freeListCount = await FreeList.countDocuments();
    const totalBalance = allUsers.reduce((s, u) => s + (u.balance || 0), 0);

    return {
        usedCodes, totalCodes, totalUsers, totalGenerations,
        freeListCount, totalBalance,
        freeLimit: FREE_LIMIT,
        pricePerSong: PRICE_PER_SONG,
    };
}

// ============ 生成记录 ============

async function saveShareRecord(record) {
    const doc = await Generation.findOne({ recordId: record.id });
    if (doc) {
        Object.assign(doc, {
            userId: record.deviceId,
            nickname: record.nickname || '',
            mood: record.mood,
            scene: record.scene,
            style: record.style,
            keyword: record.keyword,
            instrumental: record.instrumental,
            songs: record.songs,
            plays: record.plays || 0,
        });
        await doc.save();
    } else {
        await new Generation({
            recordId: record.id,
            userId: record.deviceId,
            nickname: record.nickname || '',
            mood: record.mood,
            scene: record.scene,
            style: record.style,
            keyword: record.keyword,
            instrumental: record.instrumental,
            songs: record.songs,
            plays: 0,
        }).save();
    }
}

async function getShareRecord(id) {
    const doc = await Generation.findOne({ recordId: id }).lean();
    if (!doc) return null;
    return {
        id: doc.recordId,
        deviceId: doc.userId,
        nickname: doc.nickname,
        mood: doc.mood,
        scene: doc.scene,
        style: doc.style,
        keyword: doc.keyword,
        instrumental: doc.instrumental,
        songs: doc.songs,
        createdAt: doc.createdAt?.toISOString(),
        plays: doc.plays,
    };
}

async function getSharesByDeviceId(deviceId, nickname) {
    const userId = await resolveUserId(deviceId, nickname);
    const docs = await Generation.find({ userId }).sort({ createdAt: -1 }).lean();
    return docs.map(r => ({
        id: r.recordId,
        createdAt: r.createdAt?.toISOString(),
        mood: r.mood,
        scene: r.scene,
        style: r.style,
        instrumental: r.instrumental,
        nickname: r.nickname,
        songs: (r.songs || []).map(s => ({
            title: s.title,
            audioUrl: s.audioUrl,
            videoUrl: s.videoUrl || '',
            imageUrl: s.imageUrl,
            lyrics: s.lyrics || '',
        })),
    }));
}

async function incrementSharePlays(id) {
    await Generation.updateOne({ recordId: id }, { $inc: { plays: 1 } });
}

// ============ 导出 ============

module.exports = {
    init,
    getUserQuota,
    setNickname,
    consumeFree,
    getFreeList,
    addFreeUser,
    removeFreeUser,
    addBalance,
    getUserList,
    verifyCode,
    generateCode,
    getUnusedCodes,
    getStats,
    saveShareRecord,
    getShareRecord,
    getSharesByDeviceId,
    incrementSharePlays,
    // 导出常量
    FREE_LIMIT,
    PRICE_PER_SONG,
};

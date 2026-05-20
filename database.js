/**
 * 音谋加 - 数据库模块 (JSON文件存储)
 * 无需编译，跨平台兼容
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GENERATIONS_FILE = path.join(DATA_DIR, 'generations.json');

// 确保数据目录存在
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// 读取JSON文件
function readJson(filePath) {
    ensureDataDir();
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.error(`读取文件失败: ${filePath}`, e);
        return [];
    }
}

// 写入JSON文件
function writeJson(filePath, data) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 初始化数据库
function initDatabase() {
    ensureDataDir();
    // 确保文件存在
    readJson(USERS_FILE);
    readJson(GENERATIONS_FILE);
    console.log('数据库初始化完成 (JSON模式)');
}

// 获取或创建用户
function getOrCreateUser(deviceId) {
    const users = readJson(USERS_FILE);
    let user = users.find(u => u.deviceId === deviceId);

    if (!user) {
        user = {
            id: uuidv4(),
            deviceId: deviceId,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
        users.push(user);
        writeJson(USERS_FILE, users);
    } else {
        user.lastActive = new Date().toISOString();
        const index = users.findIndex(u => u.id === user.id);
        users[index] = user;
        writeJson(USERS_FILE, users);
    }

    return user;
}

// 检查每日次数
function checkDailyQuota(userId) {
    const generations = readJson(GENERATIONS_FILE);
    const today = new Date().toISOString().split('T')[0];

    const todayCount = generations.filter(g =>
        g.userId === userId && g.createdAt.startsWith(today)
    ).length;

    const FREE_QUOTA = 3;
    return {
        remaining: Math.max(0, FREE_QUOTA - todayCount),
        total: FREE_QUOTA,
        canGenerate: todayCount < FREE_QUOTA
    };
}

// 消耗次数（通过添加记录实现）
function consumeQuota(userId) {
    // 实际上不需要单独记录，checkDailyQuota通过生成记录计算
}

// 保存生成记录
function saveGeneration(id, userId, mood, scene, style, prompt, taskId, keyword) {
    const generations = readJson(GENERATIONS_FILE);
    generations.push({
        id,
        userId,
        mood,
        scene,
        style,
        keyword,
        prompt,
        taskId,
        status: 'pending',
        audioUrl: null,  // TTAPI使用驼峰
        title: null,
        createdAt: new Date().toISOString()
    });
    writeJson(GENERATIONS_FILE, generations);
}

// 更新生成状态
function updateGeneration(taskId, status, audioUrl, title) {
    const generations = readJson(GENERATIONS_FILE);
    const index = generations.findIndex(g => g.taskId === taskId);
    if (index !== -1) {
        generations[index].status = status;
        if (audioUrl) generations[index].audioUrl = audioUrl;
        if (title) generations[index].title = title;
        writeJson(GENERATIONS_FILE, generations);
    }
}

// 获取生成记录
function getGeneration(id) {
    const generations = readJson(GENERATIONS_FILE);
    return generations.find(g => g.id === id) || null;
}

// 获取用户最近的生成记录
function getUserGenerations(userId, limit = 10) {
    const generations = readJson(GENERATIONS_FILE);
    return generations
        .filter(g => g.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
}

module.exports = {
    initDatabase,
    getOrCreateUser,
    checkDailyQuota,
    consumeQuota,
    saveGeneration,
    updateGeneration,
    getGeneration,
    getUserGenerations
};

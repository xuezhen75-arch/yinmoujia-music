/**
 * 音谋加 - 主服务器 v2.0
 * 功能：AI音乐生成 + 3次免费 + 解锁码付费
 * 部署：支持 Vercel / Railway / 任意 Node.js 主机
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AIMusicAPI = require('./aimusic-api');
const db = require('./database-simple');

// ============ 配置 ============
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'yinmoujia-admin-2024';  // 生产环境请修改！
const API_KEY = process.env.AI_MUSIC_API_KEY || '';

// 运行时配置
let config = { apiKey: API_KEY };
const musicAPI = new AIMusicAPI(API_KEY);

// ============ 初始化 ============
const app = express();
db.init();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ 工具函数 ============
function getDeviceId(req) {
    return req.body.device_id
        || req.headers['x-device-id']
        || req.query.device_id
        || 'anon-' + (req.ip || 'unknown');
}

function isAdmin(req) {
    return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

// ============ 公开接口 ============

/**
 * 获取配额信息
 * GET /api/quota?device_id=xxx
 */
app.get('/api/quota', (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const quota = db.getUserQuota(deviceId);
        res.json({ success: true, data: quota });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 验证解锁码
 * POST /api/unlock
 * Body: { device_id, code }
 */
app.post('/api/unlock', (req, res) => {
    try {
        const { device_id, code } = req.body;
        if (!device_id || !code) {
            return res.status(400).json({ success: false, error: '缺少参数' });
        }

        const result = db.verifyCode(code, device_id);
        if (result.success) {
            res.json({ success: true, data: { message: result.message, expiry: result.expiry } });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 生成音乐（核心接口）
 * POST /api/generate
 * Body: { device_id, mood, scene, style, keyword }
 */
app.post('/api/generate', async (req, res) => {
    const { device_id, mood, scene, style, keyword } = req.body;

    if (!device_id || !mood || !scene || !style) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const deviceId = device_id;

    // 检查配额
    const quota = db.getUserQuota(deviceId);
    if (!quota.canGenerate) {
        return res.json({
            success: false,
            needPayment: true,
            error: '免费次数已用完，请输入解锁码继续使用',
            data: {
                freeUsed: quota.freeUsed,
                freeLimit: quota.freeLimit,
                message: `您已使用 ${quota.freeUsed} 次，还剩 0 次。输入解锁码可继续使用。`
            }
        });
    }

    // 消耗配额
    const updatedQuota = db.consumeFree(deviceId);

    const recordId = uuidv4();

    console.log('=== 生成音乐 ===');
    console.log('设备:', deviceId);
    console.log('剩余免费次数:', updatedQuota.remaining);

    try {
        if (!config.apiKey) {
            return res.status(500).json({
                success: false,
                error: '服务器API Key未配置'
            });
        }

        console.log('⏳ 正在调用 suno-api.io...');

        const result = await musicAPI.generateMusic({ mood, scene, style, keyword });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || '生成失败'
            });
        }

        console.log('✅ 生成成功:', result.title);

        res.json({
            success: true,
            data: {
                record_id: recordId,
                task_id: result.task_id,
                status: 'completed',
                title: result.title,
                audio_url: result.audioUrl,
                image_url: result.imageUrl,
                remaining: updatedQuota.remaining,
                message: updatedQuota.remaining > 0
                    ? `🎵 生成成功！还剩 ${updatedQuota.remaining} 次免费机会`
                    : '⚠️ 免费次数已用完，如需继续请输入解锁码'
            }
        });

    } catch (error) {
        console.error('生成失败:', error);
        res.status(500).json({ success: false, error: '生成失败: ' + error.message });
    }
});

/**
 * 获取配置（前端用）
 * GET /api/config
 */
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        data: {
            version: '2.0',
            freeLimit: 3,
            paymentTip: '输入解锁码即可继续使用',
            welcome: '🎵 音谋加 - 让每个人都能用音乐表达自己'
        }
    });
});

// ============ 管理员接口（需ADMIN_TOKEN）============

/**
 * 生成解锁码
 * POST /api/admin/gen-codes
 * Header: X-Admin-Token: xxx
 * Body: { count, duration, prefix }
 */
app.post('/api/admin/gen-codes', (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ success: false, error: '未授权' });
    }

    try {
        const result = db.generateCode(req.body);
        console.log('✅ 生成解锁码:', result.codes);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 查询解锁码列表
 * GET /api/admin/codes
 */
app.get('/api/admin/codes', (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ success: false, error: '未授权' });
    }

    res.json({ success: true, data: db.getUnusedCodes() });
});

/**
 * 统计
 * GET /api/admin/stats
 */
app.get('/api/admin/stats', (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ success: false, error: '未授权' });
    }

    res.json({ success: true, data: db.getStats() });
});

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ============ 启动 ============
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║         音谋加 服务器 v2.0 已启动              ║
╠═══════════════════════════════════════════════╣
║  地址: http://localhost:${PORT}                    ║
║  前端: http://localhost:${PORT}/index.html          ║
║  API Key: ${config.apiKey ? '已配置 ✅' : '未配置 ❌'}                        ║
║  Admin: http://localhost:${PORT}/admin.html         ║
╚═══════════════════════════════════════════════╝
    `);
});

// Vercel 导出
module.exports = app;

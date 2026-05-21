/**
 * 音谋加 - 主服务器 v2.3
 * 功能：昵称登录 + AI音乐生成(双歌曲) + 5次免费 + 0.8元/首 + VIP名单 + 分享落地页
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const AIMusicAPI = require('./aimusic-api');
const db = require('./database-simple');

// ============ 配置 ============
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'yinmoujia-admin-2024';

// 豆源SUNO API 认证
const SUNO_API_ID = process.env.SUNO_API_ID || '';
const SUNO_API_TOKEN = process.env.SUNO_API_TOKEN || '';

// 动态获取站点URL（支持反向代理）
function getSiteUrl(req) {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

let config = { apiId: SUNO_API_ID, apiToken: SUNO_API_TOKEN };
const musicAPI = new AIMusicAPI(SUNO_API_ID, SUNO_API_TOKEN);

// ============ 初始化 ============
const app = express();
db.init();

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

function getNickname(req) {
    return req.body.nickname
        || req.headers['x-nickname']
        || req.query.nickname
        || '';
}

function isAdmin(req) {
    return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

// ============ 公开接口 ============

/**
 * 获取配额信息
 * GET /api/quota?device_id=xxx&nickname=xxx
 */
app.get('/api/quota', (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const nickname = req.query.nickname || '';
        // 如果有昵称，同步到用户数据
        if (nickname) db.setNickname(deviceId, nickname);
        const quota = db.getUserQuota(deviceId);
        res.json({ success: true, data: quota });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 设置昵称
 * POST /api/set-nickname
 * Body: { device_id, nickname }
 */
app.post('/api/set-nickname', (req, res) => {
    try {
        const { device_id, nickname } = req.body;
        if (!device_id || !nickname) {
            return res.status(400).json({ success: false, error: '缺少参数' });
        }
        db.setNickname(device_id, nickname.trim());
        res.json({ success: true, data: { nickname: nickname.trim() } });
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
 * Body: { device_id, nickname, mood, scene, style, keyword, lyrics, instrumental }
 */
app.post('/api/generate', async (req, res) => {
    const { device_id, nickname, mood, scene, style, keyword, lyrics, instrumental, aiDescription } = req.body;

    if (!device_id || !mood || !scene || !style) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const deviceId = device_id;

    // 同步昵称
    if (nickname) db.setNickname(deviceId, nickname.trim());

    // 检查配额
    const quota = db.getUserQuota(deviceId);
    if (!quota.canGenerate) {
        return res.json({
            success: false,
            needPayment: true,
            error: '免费次数已用完，请充值或输入解锁码',
            data: {
                freeUsed: quota.freeUsed,
                freeLimit: quota.freeLimit,
                balance: quota.balance,
                pricePerSong: 0.8,
                message: `您已使用 ${quota.freeUsed} 次，余额 ¥${quota.balance}。每首 ¥0.8，或输入解锁码`
            }
        });
    }

    // 消耗配额
    const updatedQuota = db.consumeFree(deviceId);
    if (!updatedQuota) {
        return res.json({
            success: false,
            needPayment: true,
            error: '免费次数已用完，余额不足',
            data: {
                freeUsed: quota.freeUsed,
                freeLimit: quota.freeLimit,
                balance: quota.balance,
                pricePerSong: 0.8,
                message: `免费次数已用完。充值后可继续使用，每首 ¥0.8`
            }
        });
    }

    const recordId = uuidv4();

    console.log('=== 生成音乐 ===');
    console.log('用户:', nickname || deviceId);
    console.log('剩余免费次数:', updatedQuota.remaining);

    try {
        if (!config.apiId || !config.apiToken) {
            return res.status(500).json({
                success: false,
                error: '服务器豆源SUNO API未配置（缺少SUNO_API_ID或SUNO_API_TOKEN）'
            });
        }

        console.log('正在调用 豆源SUNO API...');

        const result = await musicAPI.generateMusic({ mood, scene, style, keyword, lyrics, instrumental, aiDescription });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || '生成失败'
            });
        }

        console.log('生成成功，获得', result.songs.length, '首歌');

        // 检查是否有有效歌曲
        if (!result.songs || result.songs.length === 0) {
            return res.status(500).json({ success: false, error: '生成完成但未获取到音频，请重试' });
        }

        // 保存分享记录
        const shareData = {
            id: recordId,
            deviceId,
            nickname: nickname || '',
            mood, scene, style, keyword, instrumental: !!instrumental,
            songs: result.songs.map((s, i) => ({
                index: i,
                title: s.title,
                audioUrl: s.audioUrl,
                imageUrl: s.imageUrl,
                lyrics: s.lyrics || ''
            })),
            createdAt: new Date().toISOString(),
            plays: 0
        };
        db.saveShareRecord(shareData);

        const siteUrl = getSiteUrl(req);
        const shareUrl = `${siteUrl}/share.html?id=${recordId}`;

        res.json({
            success: true,
            data: {
                record_id: recordId,
                share_url: shareUrl,
                songs: result.songs,
                task_id: result.task_id,
                status: 'completed',
                title: result.title,
                audio_url: result.audioUrl,
                image_url: result.imageUrl,
                lyrics: result.lyrics || '',
                remaining: updatedQuota.remaining,
                balance: updatedQuota.balance,
                message: updatedQuota.remaining > 0
                    ? `生成成功！还剩 ${updatedQuota.remaining} 次免费机会`
                    : `生成成功！余额 ¥${updatedQuota.balance.toFixed(2)}`
            }
        });

    } catch (error) {
        console.error('生成失败:', error);
        res.status(500).json({ success: false, error: '生成失败: ' + error.message });
    }
});

/**
 * 获取分享记录
 * GET /api/share/:id
 */
app.get('/api/share/:id', (req, res) => {
    try {
        const record = db.getShareRecord(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, error: '分享内容不存在' });
        }
        db.incrementSharePlays(req.params.id);
        res.json({ success: true, data: record });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 获取配置
 * GET /api/config
 */
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        data: {
            version: '2.3',
            freeLimit: 5,
            pricePerSong: 0.8,
            paymentTip: '免费5次，之后每首 ¥0.8',
            welcome: '音谋加 - 让每个人都能用音乐表达自己'
        }
    });
});

/**
 * 代理下载 MP3
 * GET /api/proxy-download?url=xxx&title=xxx
 */
app.get('/api/proxy-download', async (req, res) => {
    try {
        const { url, title } = req.query;
        if (!url) return res.status(400).json({ success: false, error: '缺少 url' });

        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });

        const safeTitle = (title || 'music').replace(/[^\w\u4e00-\u9fff\-_ ]/g, '');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle + '.mp3')}`);
        res.setHeader('Content-Length', response.data.length);
        res.send(response.data);
    } catch (e) {
        res.status(500).json({ success: false, error: '下载失败: ' + e.message });
    }
});

// ============ 管理员接口 ============

app.post('/api/admin/gen-codes', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    try {
        const result = db.generateCode(req.body);
        console.log('生成解锁码:', result.codes);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/codes', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    res.json({ success: true, data: db.getUnusedCodes() });
});

app.get('/api/admin/stats', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    res.json({ success: true, data: db.getStats() });
});

/**
 * 免费名单 - 获取
 */
app.get('/api/admin/free-list', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    res.json({ success: true, data: db.getFreeList() });
});

/**
 * 免费名单 - 添加（按昵称）
 */
app.post('/api/admin/free-add', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    try {
        const { nickname } = req.body;
        if (!nickname) return res.status(400).json({ success: false, error: '请输入昵称' });
        const result = db.addFreeUser(nickname);
        if (result.success) res.json({ success: true, message: `已将「${nickname}」加入免费名单` });
        else res.status(400).json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 免费名单 - 删除（按昵称）
 */
app.post('/api/admin/free-remove', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    try {
        const { nickname } = req.body;
        if (!nickname) return res.status(400).json({ success: false, error: '请输入昵称' });
        const result = db.removeFreeUser(nickname);
        if (result.success) res.json({ success: true, message: `已将「${nickname}」从免费名单移除` });
        else res.status(400).json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 用户列表
 */
app.get('/api/admin/users', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    res.json({ success: true, data: db.getUserList() });
});

/**
 * 用户充值（按昵称或deviceId）
 */
app.post('/api/admin/recharge', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ success: false, error: '未授权' });
    try {
        const { nickname, device_id, amount } = req.body;
        const identifier = nickname || device_id;
        if (!identifier || !amount || amount <= 0) return res.status(400).json({ success: false, error: '参数无效' });
        const result = db.addBalance(identifier, parseFloat(amount));
        if (result.success) res.json({ success: true, data: result });
        else res.status(400).json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '2.3', time: new Date().toISOString() });
});

// ============ 启动 ============
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║         音谋加 服务器 v2.3 已启动              ║
╠═══════════════════════════════════════════════╣
║  地址: http://localhost:${PORT}                    ║
║  前端: http://localhost:${PORT}/index.html          ║
║  分享: http://localhost:${PORT}/share.html           ║
║  管理: http://localhost:${PORT}/admin.html         ║
║  API Key: ${config.apiKey ? '已配置' : '未配置'}                        ║
╚═══════════════════════════════════════════════╝
    `);
});

module.exports = app;

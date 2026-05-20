/**
 * 音谋加 - 主服务器
 * 对接 suno-api.io (OpenAI兼容格式，同步返回)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AIMusicAPI = require('./aimusic-api');
const db = require('./database');

// 配置
const PORT = process.env.PORT || 3000;

// 运行时配置（可动态更新）
let config = {
    apiKey: process.env.AI_MUSIC_API_KEY || null
};

// 初始化
const app = express();
const musicAPI = new AIMusicAPI(config.apiKey);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据库初始化
db.initDatabase();

// ============ API 路由 ============

/**
 * 更新配置
 * POST /api/config
 */
app.post('/api/config', (req, res) => {
    const { api_key } = req.body;

    if (api_key) {
        config.apiKey = api_key;
        musicAPI.updateApiKey(api_key);
        console.log('✅ API Key已更新');
    }

    res.json({ success: true });
});

/**
 * 获取/创建用户
 * POST /api/user
 */
app.post('/api/user', (req, res) => {
    const deviceId = req.body.device_id || req.headers['x-device-id'] || uuidv4();

    try {
        const user = db.getOrCreateUser(deviceId);
        const quota = db.checkDailyQuota(user.id);

        res.json({
            success: true,
            data: {
                user_id: user.id,
                quota: quota
            }
        });
    } catch (error) {
        console.error('创建用户失败:', error);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 检查配额
 * GET /api/quota/:userId
 */
app.get('/api/quota/:userId', (req, res) => {
    try {
        const quota = db.checkDailyQuota(req.params.userId);
        res.json({ success: true, data: quota });
    } catch (error) {
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 生成音乐
 * POST /api/generate
 */
app.post('/api/generate', async (req, res) => {
    const { user_id, mood, scene, style, keyword } = req.body;

    // 验证参数
    if (!user_id || !mood || !scene || !style) {
        return res.status(400).json({
            success: false,
            error: '缺少必要参数'
        });
    }

    // 检查配额
    const quota = db.checkDailyQuota(user_id);
    if (!quota.canGenerate) {
        return res.status(403).json({
            success: false,
            error: '今日免费次数已用完',
            data: { quota }
        });
    }

    // 消耗配额
    db.consumeQuota(user_id);

    // 生成唯一ID
    const recordId = uuidv4();

    console.log('=== 生成音乐 ===');
    console.log('API Key:', config.apiKey ? '已配置' : '未配置');

    try {
        // 检查是否配置了API Key
        if (!config.apiKey) {
            console.log('错误: API Key未配置');
            return res.status(400).json({
                success: false,
                error: '请先配置 API Key',
                data: { needApiKey: true }
            });
        }

        console.log('⏳ 正在调用 suno-api.io 生成音乐（约60-120秒）...');

        // 调用 suno-api.io（同步返回，直接出结果）
        const result = await musicAPI.generateMusic({ mood, scene, style, keyword });
        console.log('API结果:', JSON.stringify(result).substring(0, 200));

        if (!result.success) {
            console.log('生成失败:', result.error);
            return res.status(500).json({
                success: false,
                error: result.error || '生成失败'
            });
        }

        const taskId = result.task_id || recordId;
        const { prompt } = musicAPI.buildPrompt({ mood, scene, style, keyword });

        // 保存记录
        db.saveGeneration(recordId, user_id, mood, scene, style, prompt, taskId, keyword);

        // 同步更新状态（suno-api.io直接返回完整结果）
        if (result.audioUrl) {
            db.updateGeneration(taskId, 'completed', result.audioUrl, result.title);
            // 缓存结果供 /api/status 使用
            musicAPI.cacheResult(taskId, {
                success: true,
                status: 'completed',
                title: result.title,
                audioUrl: result.audioUrl,
                imageUrl: result.imageUrl,
                clips: [{
                    clipId: taskId,
                    title: result.title,
                    audioUrl: result.audioUrl,
                    imageUrl: result.imageUrl,
                    duration: 0
                }]
            });
        }

        console.log('✅ 音乐生成成功！标题:', result.title);
        console.log('🎵 音频URL:', result.audioUrl);

        res.json({
            success: true,
            data: {
                record_id: recordId,
                task_id: taskId,
                status: result.audioUrl ? 'completed' : 'pending',
                title: result.title,
                audio_url: result.audioUrl,
                image_url: result.imageUrl,
                message: result.audioUrl ? '音乐生成成功！' : '音乐生成中，请稍后查询状态'
            }
        });

    } catch (error) {
        console.error('生成失败:', error);
        res.status(500).json({ success: false, error: '生成失败: ' + error.message });
    }
});

/**
 * 查询生成状态
 * GET /api/status/:recordId
 */
app.get('/api/status/:recordId', async (req, res) => {
    const { recordId } = req.params;

    try {
        const record = db.getGeneration(recordId);

        if (!record) {
            return res.status(404).json({ success: false, error: '记录不存在' });
        }

        // 查询 AIMusicAPI
        const result = await musicAPI.getStatus(record.task_id);

        if (result.success) {
            // 更新数据库
            db.updateGeneration(
                record.task_id,
                result.status,
                result.audioUrl,
                result.title
            );

            res.json({
                success: true,
                data: {
                    status: result.status,
                    title: result.title,
                    audio_url: result.audioUrl,
                    video_url: result.videoUrl,
                    duration: result.duration,
                    clips: result.clips || []
                }
            });
        } else {
            // 仍在生成中
            res.json({
                success: true,
                data: {
                    status: 'generating',
                    title: record.title || '生成中...',
                    message: '音乐生成中，请稍后再试'
                }
            });
        }

    } catch (error) {
        console.error('查询状态失败:', error);
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

/**
 * 获取用户历史
 * GET /api/history/:userId
 */
app.get('/api/history/:userId', (req, res) => {
    try {
        const records = db.getUserGenerations(req.params.userId);
        res.json({
            success: true,
            data: records
        });
    } catch (error) {
        res.status(500).json({ success: false, error: '服务器错误' });
    }
});

// ============ 辅助函数 ============

function getTitleFromTags(mood, scene, style, keyword) {
    const moodTitles = {
        happy: ['阳光', '快乐', '美好', '欢快', '绽放'],
        sad: ['雨夜', '往事', '回忆', '独白', '离歌'],
        love: ['心动的', '爱情', '相守', '浪漫', '甜蜜'],
        relax: ['宁静', '放松', '平静', '疗愈', '清风'],
        energetic: ['热血', '力量', '冲刺', '燃烧', '追梦'],
        melancholy: ['淡淡', '忧伤', '思念', '旧时光', '如烟'],
        anxious: ['夜航', '漂泊', '孤独', '寻找', '远方'],
        nostalgic: ['那年', '时光', '旧梦', '回不去', '追忆'],
        peaceful: ['静夜', '月色', '星河', '无眠', '安然'],
        grateful: ['感谢', '遇见', '珍惜', '温暖', '有你']
    };

    const keywordTitles = {
        sunshine: '阳光', rainy: '雨季', coffee: '咖啡馆', dreamy: '梦幻',
        vintage: '旧时光', neon: '霓虹', nature: '森林', urban: '城市',
        tropical: '海岛', winter: '初雪'
    };

    const prefixes = moodTitles[mood] || ['音乐'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = keyword && keywordTitles[keyword] ? keywordTitles[keyword] : '之歌';

    return `${prefix}${suffix}`;
}

// ============ 启动服务器 ============

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║         音谋加 服务器已启动                ║
╠═══════════════════════════════════════════╣
║  地址: http://localhost:${PORT}               ║
║  前端: http://localhost:${PORT}/index.html     ║
╚═══════════════════════════════════════════╝

提示: 请设置环境变量 SUNO_API_KEY 启用真实API
    `);
});

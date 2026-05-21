/**
 * 音谋加 - 豆源SUNO API 对接模块 v4.0
 * 基于 suno.x-mi.cn (原生Suno API格式)
 *
 * v4.0 完全重写：
 * - 对接豆源SUNO API (suno.x-mi.cn/apiclouds/v1/suno/generate)
 * - 支持三种模式：灵感(AI写词)、自定义歌词、纯乐器
 * - 异步轮询获取结果
 * - 每次生成返回2首歌曲
 * - makeInstrumental: 0=有人声, 1=纯乐器 (精确控制)
 */

const axios = require('axios');

const API_BASE = 'https://suno.x-mi.cn/apiclouds/v1/suno';
const POLL_INTERVAL = 5000; // 轮询间隔5秒
const MAX_POLL_TIME = 300000; // 最大轮询5分钟

class AIMusicAPI {
    constructor(apiId, apiToken) {
        this.apiId = apiId;
        this.apiToken = apiToken;
    }

    updateCredentials(apiId, apiToken) {
        this.apiId = apiId;
        this.apiToken = apiToken;
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-apiid': this.apiId,
            'x-token': this.apiToken
        };
    }

    /**
     * 生成音乐
     * @param {Object} params
     *   - mood: 情绪 (如 'happy', 'sad', 'energetic')
     *   - scene: 场景 (如 'morning', 'night', 'workout')
     *   - style: 风格 (如 'pop', 'rock', 'jazz')
     *   - keyword: 关键词
     *   - lyrics: 自定义歌词 (空字符串=AI写词)
     *   - instrumental: true=纯乐器, false=有人声
     * @returns {Promise<{success, songs: [{title, audioUrl, imageUrl, lyrics, taskId}], error}>}
     */
    async generateMusic({ mood, scene, style, keyword, lyrics, instrumental, aiDescription }) {
        const hasCustomLyrics = lyrics && lyrics.trim().length > 0;
        const isInstrumental = !!instrumental;

        console.log('=== 豆源SUNO API 生成 ===');
        console.log('模式:', isInstrumental ? '纯乐器' : (hasCustomLyrics ? '自定义歌词' : 'AI写词(灵感)'));
        console.log('情绪:', mood, '| 场景:', scene, '| 风格:', style);

        // 构建请求体
        const body = this.buildRequestBody({ mood, scene, style, keyword, lyrics, instrumental, aiDescription });
        console.log('请求体:', JSON.stringify(body, null, 2));

        try {
            // 1. 提交生成任务
            const submitRes = await axios.post(
                `${API_BASE}/generate`,
                body,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            console.log('提交响应:', JSON.stringify(submitRes.data));

            if (submitRes.data.code !== 0) {
                return {
                    success: false,
                    error: `API错误 [${submitRes.data.code}]: ${submitRes.data.msg || '未知错误'}`
                };
            }

            const taskId = submitRes.data.data?.id;
            if (!taskId) {
                return { success: false, error: 'API未返回任务ID' };
            }

            console.log('任务ID:', taskId);

            // 2. 轮询查询结果
            const result = await this.pollTaskResult(taskId);
            return result;

        } catch (error) {
            console.error('生成请求失败:', error.message);
            if (error.response) {
                console.error('响应状态:', error.response.status);
                console.error('响应数据:', JSON.stringify(error.response.data));
            }
            return { success: false, error: 'API请求失败: ' + error.message };
        }
    }

    /**
     * 构建请求体
     */
    buildRequestBody({ mood, scene, style, keyword, lyrics, instrumental, aiDescription }) {
        const hasCustomLyrics = lyrics && lyrics.trim().length > 0;
        const isInstrumental = !!instrumental;

        // 情绪映射到英文描述
        const moodMap = {
            'happy': 'happy and uplifting',
            'sad': 'melancholic and emotional',
            'energetic': 'energetic and powerful',
            'calm': 'calm and peaceful',
            'romantic': 'romantic and tender',
            'mysterious': 'mysterious and atmospheric',
            'nostalgic': 'nostalgic and warm',
            'dreamy': 'dreamy and ethereal'
        };

        const moodDesc = moodMap[mood] || mood || 'upbeat';
        const sceneDesc = scene ? `for ${scene}` : '';
        const styleDesc = style ? `, ${style}` : '';
        const keywordDesc = keyword ? `, featuring ${keyword}` : '';

        if (isInstrumental) {
            // 纯乐器模式
            return {
                action: 'generate',
                makeInstrumental: 1,
                mvVersion: 'chirp-crow',
                inputType: 10,
                idea: `Create a ${moodDesc} instrumental music piece ${sceneDesc}${styleDesc}${keywordDesc}. Pure instrumental, no vocals, no singing.`,
                style: style || 'instrumental'
            };
        } else if (hasCustomLyrics) {
            // 自定义歌词模式
            return {
                action: 'generate',
                makeInstrumental: 0,
                mvVersion: 'chirp-crow',
                inputType: 20,
                lyric: lyrics.trim(),
                style: style || 'pop',
                title: keyword || 'My Song'
            };
        } else {
            // AI写词模式 (灵感模式)
            let idea = `Create a ${moodDesc} song ${sceneDesc}${styleDesc}${keywordDesc}. With vocals and original lyrics.`;
            // 如果用户提供了歌曲描述，追加到idea中
            if (aiDescription && aiDescription.trim()) {
                idea += ` Theme: ${aiDescription.trim()}`;
            }
            return {
                action: 'generate',
                makeInstrumental: 0,
                mvVersion: 'chirp-crow',
                inputType: 10,
                idea: idea,
                style: style || 'pop'
            };
        }
    }

    /**
     * 轮询查询任务结果
     */
    async pollTaskResult(taskId) {
        const startTime = Date.now();
        let attempts = 0;

        console.log('开始轮询任务结果...');

        while (Date.now() - startTime < MAX_POLL_TIME) {
            attempts++;
            await this.sleep(POLL_INTERVAL);

            try {
                const queryRes = await axios.post(
                    `${API_BASE}/generate`,
                    { action: 'query', id: taskId },
                    { headers: this.getHeaders(), timeout: 15000 }
                );

                console.log(`轮询 #${attempts}:`, JSON.stringify(queryRes.data).substring(0, 300));

                // 检查是否完成
                if (queryRes.data.code === 0 && queryRes.data.data) {
                    const data = queryRes.data.data;

                    // 如果返回了歌曲数据
                    if (data.status === 'completed' || data.audioUrl || data.mp3Url) {
                        const songs = this.parseSongs(data, taskId);
                        console.log('任务完成！获得', songs.length, '首歌');
                        return { success: true, songs };
                    }

                    // 如果失败了
                    if (data.status === 'failed' || data.error) {
                        return { success: false, error: data.error || '生成失败' };
                    }
                }

                // code不为0但也不是错误（可能还在处理中）
                if (queryRes.data.code !== 0) {
                    // 某些code表示还在处理，继续轮询
                    console.log(`状态码 ${queryRes.data.code}: ${queryRes.data.msg || '处理中...'}`);
                }

            } catch (error) {
                console.error(`轮询 #${attempts} 出错:`, error.message);
                // 轮询出错继续尝试，不立即失败
            }
        }

        return { success: false, error: '生成超时，请稍后到"我的作品"中查看' };
    }

    /**
     * 解析歌曲数据
     * 豆源API可能返回多种格式，这里做兼容处理
     */
    parseSongs(data, taskId) {
        const songs = [];

        // 格式1: data.songs 数组
        if (data.songs && Array.isArray(data.songs)) {
            for (const s of data.songs) {
                songs.push({
                    title: s.title || 'Untitled',
                    audioUrl: s.audioUrl || s.mp3Url || s.url || '',
                    imageUrl: s.imageUrl || s.coverUrl || s.image || '',
                    lyrics: s.lyrics || s.lyric || '',
                    taskId: taskId
                });
            }
        }

        // 格式2: data直接包含歌曲信息
        if (songs.length === 0 && (data.audioUrl || data.mp3Url)) {
            songs.push({
                title: data.title || 'Untitled',
                audioUrl: data.audioUrl || data.mp3Url || '',
                imageUrl: data.imageUrl || data.coverUrl || '',
                lyrics: data.lyrics || data.lyric || '',
                taskId: taskId
            });
        }

        // 格式3: data.music 或 data.musics 数组
        if (songs.length === 0 && data.music) {
            const musicArr = Array.isArray(data.music) ? data.music : [data.music];
            for (const m of musicArr) {
                songs.push({
                    title: m.title || 'Untitled',
                    audioUrl: m.audioUrl || m.mp3Url || m.url || '',
                    imageUrl: m.imageUrl || m.coverUrl || m.image || '',
                    lyrics: m.lyrics || m.lyric || '',
                    taskId: taskId
                });
            }
        }

        // 格式4: data.result 嵌套
        if (songs.length === 0 && data.result) {
            const r = data.result;
            if (r.audioUrl || r.mp3Url) {
                songs.push({
                    title: r.title || 'Untitled',
                    audioUrl: r.audioUrl || r.mp3Url || '',
                    imageUrl: r.imageUrl || r.coverUrl || '',
                    lyrics: r.lyrics || r.lyric || '',
                    taskId: taskId
                });
            }
        }

        return songs;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AIMusicAPI;

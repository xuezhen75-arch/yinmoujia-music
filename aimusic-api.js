/**
 * 音谋加 - suno-api.io 对接模块
 * 基于 https://www.suno-api.io (OpenAI兼容格式)
 */

const axios = require('axios');

// suno-api.io 配置（OpenAI兼容格式）
const API_BASE = 'https://api.suno-api.io/v1';

class AIMusicAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    updateApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 生成音乐
     * 使用 OpenAI 兼容接口，直接返回完整结果（同步等待）
     */
    async generateMusic({ mood, scene, style, keyword }) {
        const { prompt } = this.buildPrompt({ mood, scene, style, keyword });

        try {
            const response = await axios.post(
                `${API_BASE}/chat/completions`,
                {
                    model: 'suno-v4',
                    stream: false,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 180000  // 3分钟，音乐生成比较慢
                }
            );

            // 解析返回内容
            const content = response.data?.choices?.[0]?.message?.content
                         || response.data;

            const parsed = this.parseResponse(content, prompt);

            return {
                success: true,
                task_id: parsed.taskId || `task_${Date.now()}`,
                status: 'completed',
                title: parsed.title,
                audioUrl: parsed.audioUrl,
                imageUrl: parsed.imageUrl,
                lyrics: parsed.lyrics,
                // 兼容轮询模式
                _direct: true
            };

        } catch (error) {
            console.error('suno-api.io 生成失败:', error.message);
            if (error.response) {
                console.error('响应状态:', error.response.status);
                console.error('响应内容:', JSON.stringify(error.response.data));
            }
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * 查询生成状态（suno-api.io是同步返回，这里直接从缓存取）
     */
    async getStatus(taskId) {
        // 从内存缓存取，如果有的话
        if (this._cache && this._cache[taskId]) {
            return this._cache[taskId];
        }
        // 没有缓存则返回generating状态
        return {
            success: false,
            status: 'generating',
            error: '任务处理中'
        };
    }

    /**
     * 缓存生成结果（供getStatus使用）
     */
    cacheResult(taskId, result) {
        if (!this._cache) this._cache = {};
        this._cache[taskId] = result;
    }

    /**
     * 解析API返回的Markdown内容，提取音频URL和封面
     * 返回格式示例：
     * ## Song Title: Sunshine Receipt
     * ![Song Cover](https://cdn2.suno.ai/image_xxx.jpeg)
     * ### Lyrics:
     * [Instrumental]
     * ### Listen to the song: https://audiopipe.suno.ai/?item_id=xxx
     */
    parseResponse(content, prompt) {
        let title = '生成的音乐';
        let audioUrl = null;
        let imageUrl = null;
        let lyrics = '';
        let itemId = null;

        if (typeof content === 'string') {
            // 提取标题
            const titleMatch = content.match(/##\s*Song Title:\s*(.+)/i);
            if (titleMatch) title = titleMatch[1].trim();

            // 提取封面图
            const imageMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
            if (imageMatch) imageUrl = imageMatch[1];

            // 提取音频链接 (audiopipe.suno.ai 格式)
            const audioMatch = content.match(/https?:\/\/audiopipe\.suno\.ai\/\?item_id=([a-f0-9-]+)/i);
            if (audioMatch) {
                itemId = audioMatch[1];
                audioUrl = audioMatch[0];
            }

            // 提取歌词（Lyrics部分和Listen之间的内容）
            const lyricsMatch = content.match(/###\s*Lyrics:\s*([\s\S]*?)(?=###\s*Listen|$)/i);
            if (lyricsMatch) lyrics = lyricsMatch[1].trim();
        }

        return { title, audioUrl, imageUrl, lyrics, taskId: itemId };
    }

    /**
     * 构建提示词
     */
    buildPrompt({ mood, scene, style, keyword }) {
        const moodMap = {
            happy: {
                prompt: 'A happy and uplifting song about joy and good times',
                tags: 'upbeat, cheerful, happy pop, positive energy, joyful'
            },
            sad: {
                prompt: 'A melancholic and emotional ballad about heartbreak and sorrow',
                tags: 'melancholic, emotional ballad, tender, sad, heartbreak'
            },
            love: {
                prompt: 'A romantic and heartfelt love song about falling in love',
                tags: 'romantic, love song, warm, heartfelt, tender'
            },
            relax: {
                prompt: 'A calm and peaceful ambient music for relaxation',
                tags: 'calm, peaceful, ambient, relaxing, spa, chill'
            },
            energetic: {
                prompt: 'An energetic and powerful rock song about chasing dreams',
                tags: 'energetic, powerful, dynamic, exciting, rock, motivational'
            },
            melancholy: {
                prompt: 'A nostalgic and bittersweet folk song about memories',
                tags: 'nostalgic, bittersweet, introspective, folk, poetic'
            },
            anxious: {
                prompt: 'An introspective and moody song about inner struggles',
                tags: 'anxious, uneasy, searching, introspective, moody'
            },
            nostalgic: {
                prompt: 'A vintage and retro song about cherished memories',
                tags: 'nostalgic, vintage, retro, warm memories, sentimental'
            },
            peaceful: {
                prompt: 'A serene and tranquil meditation music',
                tags: 'peaceful, serene, meditation, zen, tranquil'
            },
            grateful: {
                prompt: 'A warm and uplifting song about gratitude and appreciation',
                tags: 'grateful, thankful, warm, uplifting, appreciation'
            }
        };

        const sceneMap = {
            morning: 'Perfect for a bright sunny morning',
            night: 'A starlit night with city lights',
            workout: 'High energy for gym and exercise',
            study: 'Focus-enhancing background music',
            travel: 'An adventure on the open road',
            alone: 'Quiet reflection and personal time',
            party: 'Fun and exciting party vibes',
            rain: 'Romantic and nostalgic rain atmosphere',
            commute: 'Urban commuting with dreams',
            sunset: 'Beautiful golden hour moments'
        };

        const styleMap = {
            pop: 'Modern pop music',
            rock: 'Rock music with electric guitars',
            electronic: 'Electronic dance music',
            folk: 'Acoustic folk music',
            jazz: 'Smooth jazz music',
            classical: 'Classical orchestral music',
            healing: 'Healing and therapeutic music',
            ambient: 'Ambient atmosphere music',
            rnb: 'R&B rhythm and blues',
            cinematic: 'Epic cinematic soundtrack'
        };

        const keywordMap = {
            sunshine: 'sunshine and warm light',
            rainy: 'rain and water atmosphere',
            coffee: 'cozy coffee shop vibes',
            dreamy: 'dreamy and ethereal atmosphere',
            vintage: 'vintage and retro feeling',
            neon: 'neon lights and cyberpunk',
            nature: 'nature and forest scenery',
            urban: 'urban city nightlife',
            tropical: 'tropical beach paradise',
            winter: 'winter snow and warmth'
        };

        const moodData = moodMap[mood] || moodMap.happy;
        const sceneDesc = sceneMap[scene] ? `, ${sceneMap[scene]}` : '';
        const styleDesc = styleMap[style] ? `, ${styleMap[style]}` : ', modern pop';
        const keywordDesc = keyword && keywordMap[keyword] ? `, ${keywordMap[keyword]}` : '';

        const prompt = `${moodData.prompt}${sceneDesc}${styleDesc}${keywordDesc}`;

        return { prompt, tags: moodData.tags };
    }
}

module.exports = AIMusicAPI;

/**
 * 音谋加 - suno-api.io 对接模块
 * 基于 https://www.suno-api.io (OpenAI兼容格式)
 * v2.2: 支持双歌曲解析 + 纯乐器模式
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
    async generateMusic({ mood, scene, style, keyword, lyrics, instrumental }) {
        const { prompt } = this.buildPrompt({ mood, scene, style, keyword, lyrics, instrumental });

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
                    timeout: 180000  // 3分钟
                }
            );

            // 解析返回内容
            const content = response.data?.choices?.[0]?.message?.content
                         || response.data;

            const songs = this.parseResponse(content);

            return {
                success: true,
                status: 'completed',
                songs: songs,  // 返回歌曲数组（1-2首）
                // 向下兼容：第一首歌的单体数据
                task_id: songs[0]?.taskId || `task_${Date.now()}`,
                title: songs[0]?.title,
                audioUrl: songs[0]?.audioUrl,
                imageUrl: songs[0]?.imageUrl,
                lyrics: songs[0]?.lyrics,
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
     * 查询生成状态
     */
    async getStatus(taskId) {
        if (this._cache && this._cache[taskId]) {
            return this._cache[taskId];
        }
        return {
            success: false,
            status: 'generating',
            error: '任务处理中'
        };
    }

    cacheResult(taskId, result) {
        if (!this._cache) this._cache = {};
        this._cache[taskId] = result;
    }

    /**
     * 解析API返回的Markdown内容，提取1-2首歌曲
     * Suno v4 默认生成2首歌，格式可能如下：
     *
     * ## Song Title: Sunshine Receipt
     * ![Song Cover](https://cdn2.suno.ai/image_xxx.jpeg)
     * ### Lyrics:
     * [Instrumental]
     * ### Listen to the song: https://audiopipe.suno.ai/?item_id=xxx
     *
     * ---
     *
     * ## Song Title: Another Song
     * ...
     */
    parseResponse(content) {
        const songs = [];

        if (typeof content !== 'string') return songs;

        // 按分隔符拆分为歌曲块（支持 "---" 或多个 "## Song Title"）
        const blocks = content.split(/\n---\n|\n={3,}\n/).filter(b => b.trim());

        for (const block of blocks) {
            const song = this.parseSingleSong(block);
            if (song.audioUrl) {
                songs.push(song);
            }
        }

        // 如果没拆分成功（只有一首歌的情况），直接解析整体
        if (songs.length === 0) {
            const song = this.parseSingleSong(content);
            if (song.audioUrl) songs.push(song);
        }

        return songs;
    }

    /**
     * 解析单首歌曲
     */
    parseSingleSong(text) {
        let title = '生成的音乐';
        let audioUrl = null;
        let imageUrl = null;
        let lyrics = '';
        let itemId = null;

        // 提取标题
        const titleMatch = text.match(/##\s*Song Title:\s*(.+)/i);
        if (titleMatch) title = titleMatch[1].trim();

        // 提取封面图
        const imageMatch = text.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
        if (imageMatch) imageUrl = imageMatch[1];

        // 提取音频链接
        const audioMatch = text.match(/https?:\/\/audiopipe\.suno\.ai\/\?item_id=([a-f0-9-]+)/i);
        if (audioMatch) {
            itemId = audioMatch[1];
            audioUrl = audioMatch[0];
        }

        // 也支持直接提取 mp3 链接
        if (!audioMatch) {
            const mp3Match = text.match(/https?:\/\/[^\s\])"']+\.mp3[^\s\])"']*/i);
            if (mp3Match) audioUrl = mp3Match[0];
        }

        // 提取歌词
        const lyricsMatch = text.match(/###\s*Lyrics:\s*([\s\S]*?)(?=###\s*Listen|$)/i);
        if (lyricsMatch) lyrics = lyricsMatch[1].trim();

        return { title, audioUrl, imageUrl, lyrics, taskId: itemId };
    }

    /**
     * 构建提示词
     */
    buildPrompt({ mood, scene, style, keyword, lyrics, instrumental }) {
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

        let prompt;
        if (instrumental) {
            // 纯乐器模式：不加歌词
            prompt = `${moodData.prompt}${sceneDesc}${styleDesc}${keywordDesc}, Instrumental only, no vocals, no lyrics, pure music`;
        } else if (lyrics && lyrics.trim()) {
            // 用户提供了自定义歌词
            prompt = `${lyrics.trim()}\n\n[Style: ${moodData.tags}${styleDesc}]`;
        } else {
            // AI 自动生成歌词（明确要求人声和歌词）
            prompt = `${moodData.prompt}${sceneDesc}${styleDesc}${keywordDesc}, with vocals and AI-generated lyrics, include singing`;
        }

        return { prompt, tags: moodData.tags };
    }
}

module.exports = AIMusicAPI;

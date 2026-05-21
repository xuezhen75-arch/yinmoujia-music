/**
 * 音谋加 - Suno API 对接模块 v3.0
 * 基于 api.suno-api.io (OpenAI兼容格式)
 * 
 * v3.0 彻底重写：
 * - Prompt策略优化：三种模式（AI写词/自定义歌词/纯乐器）各有专用prompt格式
 * - 双歌曲解析增强：更健壮的Markdown解析
 * - 详细日志输出，便于排查
 */

const axios = require('axios');

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
     * 返回 { success, songs: [{title, audioUrl, imageUrl, lyrics, taskId}] }
     */
    async generateMusic({ mood, scene, style, keyword, lyrics, instrumental }) {
        const { prompt, tags } = this.buildPrompt({ mood, scene, style, keyword, lyrics, instrumental });

        console.log('=== Prompt 构建 ===');
        console.log('模式:', instrumental ? '纯乐器' : (lyrics?.trim() ? '自定义歌词' : 'AI写词'));
        console.log('Prompt长度:', prompt.length);
        console.log('Prompt前100字:', prompt.substring(0, 100));

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
                    timeout: 180000
                }
            );

            const content = response.data?.choices?.[0]?.message?.content
                         || response.data;

            console.log('=== API 返回 ===');
            console.log('类型:', typeof content);
            console.log('长度:', typeof content === 'string' ? content.length : 'N/A');

            if (typeof content === 'string') {
                console.log('内容前500字:', content.substring(0, 500));
            } else {
                console.log('非字符串内容:', JSON.stringify(content).substring(0, 500));
            }

            const songs = this.parseResponse(content);

            console.log(`解析结果: ${songs.length} 首歌`);
            songs.forEach((s, i) => {
                console.log(`  歌曲${i+1}: title="${s.title}", hasAudio=${!!s.audioUrl}, lyricsLen=${s.lyrics?.length || 0}`);
            });

            if (songs.length === 0) {
                return {
                    success: false,
                    error: 'API返回了数据但未能解析出歌曲，请重试'
                };
            }

            return {
                success: true,
                status: 'completed',
                songs: songs,
                task_id: songs[0]?.taskId || `task_${Date.now()}`,
                title: songs[0]?.title,
                audioUrl: songs[0]?.audioUrl,
                imageUrl: songs[0]?.imageUrl,
                lyrics: songs[0]?.lyrics,
                _raw: content
            };

        } catch (error) {
            console.error('=== API 调用失败 ===');
            console.error('错误:', error.message);
            if (error.response) {
                console.error('状态:', error.response.status);
                console.error('响应:', JSON.stringify(error.response.data).substring(0, 1000));
            }
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * 解析API返回的Markdown内容，提取歌曲
     */
    parseResponse(content) {
        const songs = [];

        if (typeof content !== 'string') {
            console.warn('parseResponse: content 不是字符串，跳过解析');
            return songs;
        }

        // 策略1: 按 "---" 或 "===" 分隔
        const blocks = content.split(/\n---\s*\n|\n===+\n/).filter(b => b.trim());

        for (const block of blocks) {
            const song = this.parseSingleSong(block);
            if (song.audioUrl) {
                songs.push(song);
            }
        }

        // 策略2: 如果分隔失败，按 "## Song Title" 出现次数拆分
        if (songs.length === 0) {
            const titlePositions = [];
            const regex = /##\s*Song Title:/gi;
            let match;
            while ((match = regex.exec(content)) !== null) {
                titlePositions.push(match.index);
            }

            if (titlePositions.length >= 2) {
                for (let i = 0; i < titlePositions.length; i++) {
                    const start = titlePositions[i];
                    const end = i + 1 < titlePositions.length ? titlePositions[i + 1] : content.length;
                    const block = content.substring(start, end);
                    const song = this.parseSingleSong(block);
                    if (song.audioUrl) songs.push(song);
                }
            }
        }

        // 策略3: 如果只有一首歌，直接解析整体
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

        // 提取音频链接 - 支持多种格式
        const audioPatterns = [
            /https?:\/\/audiopipe\.suno\.ai\/\?item_id=([a-f0-9\-]+)/i,
            /https?:\/\/cdn[12]\.suno\.ai\/[^\s\])"'\n]+\.mp3[^\s\])"'\n]*/i,
            /https?:\/\/[^\s\])"']+\.mp3[^\s\])"'\n]*/i,
            /https?:\/\/[^\s\])"']+audio[^\s\])"'\n]*/i
        ];

        for (const pattern of audioPatterns) {
            const m = text.match(pattern);
            if (m) {
                audioUrl = m[0];
                itemId = m[1] || null;
                break;
            }
        }

        // 提取歌词 - 支持多种格式
        const lyricsPatterns = [
            /###\s*Lyrics:\s*([\s\S]*?)(?=###\s*(?:Listen|Song)|$)/i,
            /###\s*Lyrics\s*:\s*([\s\S]*?)(?=\n###|\n##|$)/i,
            /\[Lyrics\]\s*([\s\S]*?)(?=\[Listen|\[Song|$)/i
        ];

        for (const pattern of lyricsPatterns) {
            const m = text.match(pattern);
            if (m) {
                lyrics = m[1].trim();
                break;
            }
        }

        return { title, audioUrl, imageUrl, lyrics, taskId: itemId };
    }

    /**
     * 构建提示词 v3.0
     * 
     * 三种模式：
     * 1. AI写词: prompt描述音乐风格 + 明确要求AI写歌词和人声
     * 2. 自定义歌词: 用户提供歌词 + style描述
     * 3. 纯乐器: prompt描述音乐风格 + Instrumental指令
     */
    buildPrompt({ mood, scene, style, keyword, lyrics, instrumental }) {
        const moodMap = {
            happy:        { desc: 'happy and uplifting pop song about joy and good times', tags: 'upbeat, cheerful, pop, positive energy' },
            sad:          { desc: 'melancholic emotional ballad about heartbreak and loss', tags: 'melancholic, emotional ballad, tender, sad' },
            love:         { desc: 'romantic love song about falling in love', tags: 'romantic, love song, warm, heartfelt' },
            relax:        { desc: 'calm peaceful music for relaxation', tags: 'calm, peaceful, ambient, relaxing, chill' },
            energetic:    { desc: 'energetic powerful song about chasing dreams', tags: 'energetic, powerful, dynamic, rock' },
            melancholy:   { desc: 'nostalgic bittersweet folk song about memories', tags: 'nostalgic, bittersweet, folk, poetic' },
            anxious:      { desc: 'introspective moody song about inner struggles', tags: 'anxious, uneasy, introspective, moody' },
            nostalgic:    { desc: 'vintage retro song about cherished memories', tags: 'nostalgic, vintage, retro, warm, sentimental' },
            peaceful:     { desc: 'serene tranquil meditation music', tags: 'peaceful, serene, meditation, zen, tranquil' },
            grateful:     { desc: 'warm uplifting song about gratitude', tags: 'grateful, thankful, warm, uplifting' }
        };

        const sceneMap = {
            morning: 'for a bright sunny morning',
            night:   'for a starlit night with city lights',
            workout: 'for gym and exercise high energy',
            study:   'for focus and concentration',
            travel:  'for an adventure on the open road',
            alone:   'for quiet reflection and personal time',
            party:   'for fun and exciting party vibes',
            rain:    'with romantic nostalgic rain atmosphere',
            commute: 'for urban commuting with dreams',
            sunset:  'for beautiful golden hour moments'
        };

        const styleMap = {
            pop:       'modern pop',
            rock:      'rock with electric guitars',
            electronic:'electronic dance music',
            folk:      'acoustic folk',
            jazz:      'smooth jazz',
            classical: 'classical orchestral',
            healing:   'healing therapeutic music',
            ambient:   'ambient atmosphere',
            rnb:       'R&B rhythm and blues',
            cinematic: 'epic cinematic soundtrack'
        };

        const keywordMap = {
            sunshine: 'with sunshine and warm light',
            rainy:    'with rain and water atmosphere',
            coffee:   'with cozy coffee shop vibes',
            dreamy:   'with dreamy ethereal atmosphere',
            vintage:  'with vintage retro feeling',
            neon:     'with neon lights and cyberpunk vibes',
            nature:   'with nature and forest scenery',
            urban:    'with urban city nightlife',
            tropical: 'with tropical beach paradise',
            winter:   'with winter snow and warmth'
        };

        const moodData = moodMap[mood] || moodMap.happy;
        const sceneDesc = sceneMap[scene] ? ` ${sceneMap[scene]}` : '';
        const styleDesc = styleMap[style] ? `, ${styleMap[style]}` : ', modern pop';
        const keywordDesc = keyword && keywordMap[keyword] ? `, ${keywordMap[keyword]}` : '';

        let prompt;
        let tags;

        if (instrumental) {
            // ========= 模式3: 纯乐器 =========
            prompt = `Create an instrumental track: A ${moodData.desc}${sceneDesc}, ${styleMap[style] || 'modern pop'}${keywordDesc}. Pure instrumental, no vocals, no lyrics, no singing.`;
            tags = `instrumental, ${moodData.tags}, ${styleMap[style] || 'modern pop'}`;

        } else if (lyrics && lyrics.trim()) {
            // ========= 模式2: 自定义歌词 =========
            // 把用户歌词作为 prompt，附加风格标签
            prompt = `[Lyrics]\n${lyrics.trim()}\n\n[Style: ${moodData.tags}${styleDesc}${keywordDesc}]\n[Scene: ${sceneMap[scene] || 'general'}]\n\nPlease compose and produce this song with vocals singing the provided lyrics.`;
            tags = `${moodData.tags}, ${styleMap[style] || 'modern pop'}, with vocals`;

        } else {
            // ========= 模式1: AI写词 =========
            // 明确要求生成有歌词和人声的歌曲
            prompt = `Create a ${moodData.desc}${sceneDesc}, ${styleMap[style] || 'modern pop'}${keywordDesc}. 

This MUST be a vocal song with original AI-generated lyrics. The song should have a verse-chorus structure with meaningful lyrics about the theme. Include a singer with clear vocals. Do NOT make this instrumental.

Format: Write the complete lyrics with [Verse], [Chorus] sections, then produce the song.`;
            tags = `${moodData.tags}, ${styleMap[style] || 'modern pop'}, with vocals, with lyrics`;
        }

        return { prompt, tags };
    }
}

module.exports = AIMusicAPI;

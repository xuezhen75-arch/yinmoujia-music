/**
 * 音谋加 - Suno API 对接模块 (TTAPI)
 * 基于 https://docs.ttapi.io/api/cn/suno
 */

const axios = require('axios');

// TTAPI 配置
const TTAPI_BASE = 'https://api.ttapi.io';
const TT_API_KEY = process.env.TT_API_KEY || 'your_ttapi_key_here';

class SunoAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    updateApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 生成音乐
     * @param {Object} params - 生成参数
     * @param {string} params.mood - 心情标签
     * @param {string} params.scene - 场景标签
     * @param {string} params.style - 风格标签
     * @returns {Promise<Object>} 生成结果
     */
    async generateMusic({ mood, scene, style }) {
        // 构建提示词和标签
        const { prompt, tags, title } = this.buildPrompt({ mood, scene, style });

        try {
            const response = await axios.post(
                `${TTAPI_BASE}/suno/v1/music`,
                {
                    mv: 'chirp-v5-5',  // Suno v5.5 模型
                    prompt: prompt,
                    tags: tags,
                    title: title,
                    custom: true,
                    instrumental: false
                },
                {
                    headers: {
                        'TT-API-KEY': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            if (response.data.status === 'SUCCESS') {
                return {
                    success: true,
                    job_id: response.data.data.jobId,
                    status: 'pending'
                };
            } else {
                return {
                    success: false,
                    error: response.data.message || '生成失败'
                };
            }
        } catch (error) {
            console.error('Suno API 生成失败:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 查询生成状态
     * @param {string} jobId - 任务ID
     * @returns {Promise<Object>} 状态结果
     */
    async getStatus(jobId) {
        try {
            const response = await axios.get(
                `${TTAPI_BASE}/suno/v2/fetch?jobId=${jobId}`,
                {
                    headers: {
                        'TT-API-KEY': this.apiKey
                    },
                    timeout: 15000
                }
            );

            const data = response.data;

            if (data.status === 'SUCCESS') {
                const music = data.data.musics[0];
                return {
                    success: true,
                    status: 'completed',
                    title: music?.title || '未命名歌曲',
                    audioUrl: music?.audioUrl || null,  // TTAPI返回的是audioUrl
                    videoUrl: music?.videoUrl || null,
                    duration: music?.duration || 0
                };
            } else if (data.status === 'ON_QUEUE') {
                return {
                    success: true,
                    status: 'pending',
                    progress: data.data.progress || '0%'
                };
            } else {
                return {
                    success: false,
                    error: data.message || '未知状态'
                };
            }
        } catch (error) {
            console.error('Suno API 查询失败:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 构建提示词和标签
     * @param {Object} params - 参数对象
     * @param {string} params.mood - 心情
     * @param {string} params.scene - 场景
     * @param {string} params.style - 风格
     * @param {string} params.keyword - 关键词（可选）
     */
    buildPrompt({ mood, scene, style, keyword }) {
        // 心情描述
        const moodMap = {
            happy: {
                prompt: '快乐的心情，阳光明媚，美好的一天，充满希望',
                tags: 'upbeat, cheerful, happy pop, positive energy, joyful'
            },
            sad: {
                prompt: '伤感的心情，深夜独处，回忆往事，心碎的感觉',
                tags: 'melancholic, emotional ballad, tender, sad, heartbreak'
            },
            love: {
                prompt: '甜蜜的爱情，心跳加速，相爱的人，幸福满溢',
                tags: 'romantic, love song, warm, heartfelt, tender'
            },
            relax: {
                prompt: '放松的时光，宁静的午后，心灵平静，舒适惬意',
                tags: 'calm, peaceful, ambient, relaxing, spa, chill'
            },
            energetic: {
                prompt: '热血沸腾，充满力量，追逐梦想，永不放弃',
                tags: 'energetic, powerful, dynamic, exciting, rock, motivational'
            },
            melancholy: {
                prompt: '忧郁的思绪，雨夜回忆，淡淡忧伤，诗意浪漫',
                tags: 'nostalgic, bittersweet, introspective, folk, poetic'
            },
            anxious: {
                prompt: '焦虑不安，内心挣扎，寻找方向，充满不确定',
                tags: 'anxious, uneasy, searching, introspective, moody'
            },
            nostalgic: {
                prompt: '怀旧的时光，往事浮现，岁月如歌，美好回忆',
                tags: 'nostalgic, vintage, retro, warm memories, sentimental'
            },
            peaceful: {
                prompt: '内心平静，与自己对话，岁月静好，云淡风轻',
                tags: 'peaceful, serene, meditation, zen, tranquil'
            },
            grateful: {
                prompt: '心怀感恩，珍惜拥有，温暖前行，感谢遇见',
                tags: 'grateful, thankful, warm, uplifting, appreciation'
            }
        };

        // 场景描述
        const sceneMap = {
            morning: '清晨的阳光，新的一天开始，咖啡香气',
            night: '夜晚的星空，宁静的夜色，万家灯火',
            workout: '健身时刻，充满活力，汗水淋漓',
            study: '学习时光，专注思考，书香气息',
            travel: '旅途中的风景，探索世界，自由飞翔',
            alone: '独处的时光，与自己对话，静静思考',
            party: '派对狂欢，释放自我，音乐舞蹈',
            rain: '雨天的街道，浪漫氛围，窗边听雨',
            commute: '城市通勤，脚步匆匆，梦想在路上',
            sunset: '黄昏时分，落日余晖，温柔时刻'
        };

        // 风格描述
        const styleMap = {
            pop: '流行音乐，朗朗上口，现代感强',
            rock: '摇滚风格，热烈奔放，电吉他轰鸣',
            electronic: '电子音乐，动感激昂，合成器音色',
            folk: '民谣风格，温暖叙事，木吉他为主',
            jazz: '爵士乐，慵懒优雅，萨克斯风韵',
            classical: '古典音乐，典雅大气，钢琴交响',
            healing: '治愈系音乐，舒缓心灵，温暖治愈',
            ambient: '氛围音乐，空灵飘渺，意境深远',
            rnb: '节奏布鲁斯，丝滑律动，现代都市感',
            cinematic: '电影配乐，戏剧张力，画面感强'
        };

        // 关键词描述
        const keywordMap = {
            sunshine: '阳光灿烂，金色光芒，温暖明亮',
            rainy: '雨声淅沥，湿润空气，浪漫忧郁',
            coffee: '咖啡香气，慵懒午后，小资情调',
            dreamy: '梦幻飘渺，星光闪烁，如入仙境',
            vintage: '复古怀旧，老唱片感，时光流转',
            neon: '霓虹闪烁，赛博朋克，未来都市',
            nature: '自然森林，鸟语花香，绿色盎然',
            urban: '都市夜景，车水马龙，钢铁森林',
            tropical: '热带风情，海风椰林，阳光沙滩',
            winter: '冬日初雪，寒冷浪漫，围炉夜话'
        };

        const moodData = moodMap[mood] || moodMap.happy;
        const sceneDesc = sceneMap[scene] || '';
        const styleDesc = styleMap[style] || '流行音乐';
        const keywordDesc = keyword && keywordMap[keyword] ? `，${keywordMap[keyword]}` : '';

        // 组合完整提示词
        const prompt = `${moodData.prompt}，${sceneDesc}。${styleDesc}${keywordDesc}。`;

        // 组合标签
        const keywordTags = keyword && keywordMap[keyword] ? `, ${keyword}` : '';
        const tags = `${moodData.tags}, ${style}${keywordTags}`;

        // 生成标题
        const titlePrefixes = {
            happy: ['阳光', '快乐', '美好', '欢快', '绽放', '微笑'],
            sad: ['雨夜', '往事', '回忆', '独白', '离歌', '再见'],
            love: ['心动的', '爱情', '相守', '浪漫', '甜蜜', '永远'],
            relax: ['宁静', '放松', '平静', '疗愈', '清风', '自在'],
            energetic: ['热血', '力量', '冲刺', '燃烧', '追梦', '飞翔'],
            melancholy: ['淡淡', '忧伤', '思念', '旧时光', '如烟', '流年'],
            anxious: ['夜航', '漂泊', '孤独', '寻找', '远方', '迷途'],
            nostalgic: ['那年', '时光', '旧梦', '回不去', '追忆', '曾经'],
            peaceful: ['静夜', '月色', '星河', '无眠', '安然', '从容'],
            grateful: ['感谢', '遇见', '珍惜', '温暖', '有你', '相伴']
        };

        const keywordSuffixes = {
            sunshine: '阳光', rainy: '雨季', coffee: '咖啡馆', dreamy: '梦境',
            vintage: '时光', neon: '霓虹', nature: '森林', urban: '城市',
            tropical: '海岛', winter: '初雪'
        };

        const prefixes = titlePrefixes[mood] || ['音乐'];
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const suffix = keyword && keywordSuffixes[keyword] ? keywordSuffixes[keyword] : '之歌';

        const title = `${prefix}${suffix}`;

        return { prompt, tags, title };
    }
}

module.exports = SunoAPI;

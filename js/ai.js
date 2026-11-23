// AI 查歌：用 Claude 找出歌曲的調性、速度與每小節和弦，再交給本機編曲引擎轉成指彈譜。
// 只取得和弦進行（不含歌詞與旋律），API 金鑰只存在使用者自己的瀏覽器。
import { parseChord } from './theory.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';
const MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'title', 'artist', 'key', 'bpm', 'timeSig', 'sections', 'note'],
  properties: {
    found: { type: 'boolean', description: '是否確定認得這首歌' },
    title: { type: 'string' },
    artist: { type: 'string' },
    key: { type: 'string', description: '原曲調性，例如 G 或 Em' },
    bpm: { type: 'integer' },
    timeSig: { type: 'string', enum: ['4/4', '3/4'] },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'bars'],
        properties: {
          name: { type: 'string', description: '段落名稱（繁體中文），例如 前奏、主歌、副歌、間奏、尾奏' },
          bars: { type: 'array', items: { type: 'string' }, description: '每個元素是一個小節的和弦' },
        },
      },
    },
    note: { type: 'string', description: '給吉他學習者的簡短說明（繁體中文）' },
  },
};

const SYSTEM = `你是一位吉他老師，熟悉華語、台語、英文、日韓流行歌與民謠的和弦。
使用者會給你一個歌名（可能包含歌手名）。請辨認這首歌，並提供它在原調的和弦進行，讓程式把它編成指彈吉他譜。

規則：
- 依照歌曲結構列出段落（前奏、主歌、導歌、副歌、間奏、尾奏…），重複的段落只列一次，總小節數控制在 64 小節以內。
- bars 陣列中每個字串是一個小節：和弦用空白分隔，會平均分配拍數；若不平均，用「C:3 G:1」標示拍數。
- 和弦使用標準記號，例如 C、Am、G7、Fmaj7、Dsus4、C/E、F#m、Bb。不要寫歌詞或旋律。
- bpm 填原曲大約速度；timeSig 只能是 4/4 或 3/4。
- 如果你不確定是哪一首歌，或不確定它的和弦，found 設為 false，sections 留空，並在 note 說明原因。不要編造。
- note 用繁體中文寫一兩句練習建議（例如原曲常見的移調夾位置、節奏特色）。`;

function toBars(data) {
  const bars = [];
  for (const sec of data.sections || []) {
    (sec.bars || []).forEach((b, i) => {
      const tokens = String(b).trim().split(/\s+/).filter((tok) => parseChord(tok.split(':')[0]));
      if (!tokens.length) return;
      bars.push({ c: tokens.join(' '), ...(i === 0 ? { sec: sec.name } : {}) });
    });
  }
  return bars;
}

export async function lookupSongWithAI(query, apiKey) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch (e) {
    throw new Error('無法載入 AI 套件，請確認網路連線。');
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `歌名：${query}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API 金鑰無效，請到「設定」重新輸入。');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('這把 API 金鑰沒有使用權限。');
    if (err instanceof Anthropic.RateLimitError) throw new Error('請求太頻繁或額度不足，請稍後再試。');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('連不上 AI 服務，請檢查網路。');
    if (err instanceof Anthropic.APIError) throw new Error(`AI 服務錯誤（${err.status ?? '未知'}）：${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('AI 無法處理這個請求，請改用手動輸入和弦。');
  if (response.stop_reason === 'max_tokens') throw new Error('AI 回覆被截斷，請再試一次。');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('AI 回傳的格式無法解析，請再試一次。');
  }
  if (!data.found) {
    const err = new Error(data.note || 'AI 不認得這首歌，請確認歌名或手動輸入和弦。');
    err.notFound = true;
    throw err;
  }
  const bars = toBars(data);
  if (!bars.length) throw new Error('AI 沒有提供可用的和弦。');
  return {
    title: data.title || query,
    artist: data.artist || '',
    key: data.key || '',
    bpm: Math.max(40, Math.min(220, data.bpm || 90)),
    timeSig: data.timeSig === '3/4' ? [3, 4] : [4, 4],
    bars,
    note: data.note || '',
  };
}

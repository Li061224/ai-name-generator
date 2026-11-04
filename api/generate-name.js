import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 密钥与配置全部从环境变量读取，不写死
  // OPENAI_BASE_URL 默认 DeepSeek（国内直连），也可换成 OpenAI 等兼容端点
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const MODEL_NAME = process.env.MODEL_NAME || 'deepseek-chat';

  if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response('缺少环境变量配置，请检查 Vercel 环境变量', { status: 500 });
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { prompt } = await req.json();
  if (!prompt || !prompt.trim()) {
    return new Response('请输入起名需求', { status: 400 });
  }

  const systemPrompt = `
你是专业起名大师。根据用户需求，输出严格3组名字，每组包含【名字】+【寓意】。
输出格式示例：
1. 名字：知屿
寓意：取自知山知水，心有芳屿，寓意内心丰盈，安稳自持。
2. 名字：清禾
寓意：清如朝露，禾沐春风，象征纯粹质朴，向阳生长。
3. 名字：景珩
寓意：景是光景前程，珩为古玉，寓意前程明亮，如玉温润。
不要多余开场白，直接输出3组。
`;

  const stream = await openai.chat.completions.create({
    model: MODEL_NAME,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  });

  const encoder = new TextEncoder();
  let fullContent = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content || '';
          if (text) {
            fullContent += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();

        // 流式结束后保存：用户需求、生成结果、模型名
        await supabase.from('ai_name_records').insert({
          user_prompt: prompt,
          result_json: { content: fullContent },
          model_name: MODEL_NAME
        });
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}

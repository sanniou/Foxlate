#!/usr/bin/env node
/**
 * 本地端到端自测的假翻译服务 + 假页面。
 *
 * 为什么需要它：页面翻译、输入翻译、选区翻译、摘要四条链路都依赖远端翻译/AI 服务。
 * 没有固定环境时，「功能是不是坏的」和「网络是不是坏的」分不开，自测结论就只能靠读代码。
 * 这里用本地 HTTP 复刻两条真实协议（DeepLX `POST /translate`、OpenAI `POST /v1/chat/completions`），
 * 于是任何一条链路出问题都能被确定性地复现。
 *
 * 用法：
 *   node scripts/e2e/mock-server.mjs [port]        # 默认 8931
 *   然后把扩展的引擎指过来：DeepLX 地址 http://127.0.0.1:8931/translate
 *   AI 引擎 apiUrl http://127.0.0.1:8931/v1/chat/completions（apiKey 任意非空）
 *   测试页面：http://127.0.0.1:8931/ 和 /long
 *
 * 译文一律加 `【译】` / `【AI】` 前缀：页面上看得见，就能判断「翻译过的节点」和
 * 「原样保留的节点」，不用逐条比对文本。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? 8931);

const ARTICLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Foxlate E2E Fixture — The Quiet River</title>
<style>
  body { font: 16px/1.7 system-ui, sans-serif; margin: 0; background: #fff; color: #16181d; }
  article { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; }
  h1 { line-height: 1.2; } code { background: #f2f3f5; padding: .1em .3em; border-radius: 4px; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d8dbe0; padding: .4rem .6rem; }
  blockquote { border-left: 3px solid #d8dbe0; margin: 1rem 0; padding: .25rem 0 .25rem 1rem; color: #4a4f59; }
</style></head>
<body>
<nav><a href="/">Home</a> · <a href="/long">Long page</a></nav>
<article>
  <h1>The Quiet River Runs North</h1>
  <p>Every spring the river changes its mind about where it belongs. It leaves a little gravel behind and takes a little soil away, and by June nobody can agree on where the bank used to be.</p>
  <h2>What the water remembers</h2>
  <p>The water does not remember anything. That is the whole point of it. <a href="/long">A longer account</a> is available, but the short version is that rivers are in the business of forgetting their own history.</p>
  <ul>
    <li>Gravel moves downstream in floods.</li>
    <li>Silt settles where the current slows.</li>
    <li>Willows take root on whatever is left.</li>
  </ul>
  <blockquote>A river is a verb that someone mistook for a noun.</blockquote>
  <h2>Measurements</h2>
  <table>
    <caption>Discharge at the north gauge</caption>
    <tr><th>Month</th><th>Flow</th></tr>
    <tr><td>April</td><td>Twelve cubic metres per second.</td></tr>
    <tr><td>June</td><td>Forty cubic metres per second.</td></tr>
  </table>
  <p>Researchers use <code>Q = A × v</code> to describe this, where the letters mean less than they seem to.</p>
  <h2>Field notes</h2>
  <p>We walked the bank for three hours and found two herons, one otter, and a boot that no longer belonged to anyone.</p>
  <form><label for="q">Search the archive</label><input id="q" type="text" placeholder="Type a question…"></form>
  <p><textarea id="notes" rows="3" placeholder="Field notes go here"></textarea></p>
</article>
<footer><p>Fixture page for Foxlate translation end-to-end checks.</p></footer>
</body></html>`;

function longsPage(count) {
    const paras = Array.from({ length: count }, (_, index) => (
        `<p>Paragraph ${index + 1}. The river bends again here, and the silt gathers on the inside of the curve, which is why the far bank is always the one that grows tomatoes.</p>`
    )).join('\n  ');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Foxlate E2E Fixture — Long page</title></head>
<body><main><h1>Three Hundred Bends</h1>
  ${paras}
</main></body></html>`;
}

/** 从一段文本里抠出第一个完整的 JSON 数组（模型/批次提示词里就是这么嵌的）。 */
function extractJsonArray(text) {
    const start = text.indexOf('[');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '[') depth += 1;
        else if (char === ']') {
            depth -= 1;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }
    return null;
}

function json(response, status, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
    response.end(body);
}

function readBody(request) {
    return new Promise(resolve => {
        let raw = '';
        request.on('data', chunk => { raw += chunk; });
        request.on('end', () => {
            try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
        });
    });
}

const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    // 请求日志：自测时能直接看出「请求有没有发出来」，不用再靠猜。
    if (process.env.E2E_VERBOSE !== '0') {
        console.log(`[mock] ${request.method} ${url.pathname}`);
    }

    if (request.method === 'OPTIONS') {
        response.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'content-type, authorization',
            'access-control-allow-methods': 'POST, GET, OPTIONS',
        });
        response.end();
        return;
    }

    // 控件外观基线自检页。
    //
    // 把**构建产物**里的 CSS 直接内联进来，再放几个真实的控件标记：这样量到的是
    // dist 里的那几行样式在「别人的文档」里的实际计算结果，而不是源码里的意图。
    // 目录：摘要悬浮按钮与面板标签页曾被宿主的 UA 外观套上 2px outset 黑框 + Arial。
    if (url.pathname === '/harness/controls') {
        const distRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
        const read = async file => {
            try {
                return await readFile(path.join(distRoot, file), 'utf8');
            } catch {
                return `/* missing: ${file} */`;
            }
        };
        const sheets = await Promise.all([
            'common/tokens.css',
            'content/control-reset.css',
            'content/style.css',
            'content/summary/summary.css',
        ].map(read));
        const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
            <title>Foxlate 控件基线自检</title>
            ${sheets.map(css => `<style>${css}</style>`).join('\n')}
            <style>
              /* 故意写一条宿主页面的元素级规则：基线必须压得住它。 */
              button { border: 3px dashed #f00; font-family: "Times New Roman", serif; padding: 11px; }
            </style>
            </head><body>
            <main>
              <button id="summary-button" class="foxlate-summary-button" aria-label="摘要">S</button>
              <div class="foxlate-summary-dialog">
                <div class="foxlate-summary-tabs" role="tablist">
                  <button id="tab" class="foxlate-summary-tab active" role="tab">
                    <span class="foxlate-summary-tab-title">页面摘要</span>
                    <button id="tab-close" class="foxlate-summary-tab-close" aria-label="关闭">x</button>
                  </button>
                </div>
              </div>
            </main></body></html>`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
    }

    if (url.pathname === '/translate' && request.method === 'POST') {
        const body = await readBody(request);
        const text = typeof body.text === 'string' ? body.text : '';
        json(response, 200, {
            code: 200,
            id: Date.now(),
            data: text ? `【译】${text}` : '',
            alternatives: [],
            source_lang: body.source_lang || 'EN',
            target_lang: body.target_lang || 'ZH',
        });
        return;
    }

    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        const body = await readBody(request);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const system = messages.find(message => message.role === 'system')?.content ?? '';
        const userContent = messages.filter(message => message.role !== 'system')
            .map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
            .join('\n');

        // 批量翻译：系统提示词明确要求「只返回 JSON 字符串数组」。
        if (/JSON array of strings/i.test(system)) {
            const arrayText = extractJsonArray(userContent);
            let items = [];
            try { items = arrayText ? JSON.parse(arrayText) : []; } catch { items = []; }
            json(response, 200, {
                choices: [{ message: { role: 'assistant', content: JSON.stringify(items.map(item => `【AI】${item}`)) } }],
            });
            return;
        }

        // 摘要：返回 markdown，用来验证面板渲染（标题/列表/加粗/行内代码）。
        if (/summar|摘要/i.test(system) || /summar|摘要/i.test(userContent)) {
            json(response, 200, {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: [
                            '## 摘要',
                            '',
                            '- 河流每年改道，河岸因此没有稳定边界。',
                            '- 流量从四月到六月增长到三倍以上。',
                            '',
                            '**关键判断**：河不是名词，是过程。代码里的 `Q = A × v` 只是记号。',
                        ].join('\n'),
                    },
                }],
            });
            return;
        }

        // 单条翻译 / 追问：原样回显并加前缀，方便一眼认出扩展改写了哪一块。
        json(response, 200, {
            choices: [{ message: { role: 'assistant', content: `【AI】${userContent}` } }],
        });
        return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(ARTICLE);
        return;
    }

    if (url.pathname === '/long') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(longsPage(Number(url.searchParams.get('paras') ?? 120)));
        return;
    }

    json(response, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`mock translation + AI service on http://127.0.0.1:${PORT}`);
    console.log(`  deeplx apiUrl: http://127.0.0.1:${PORT}/translate`);
    console.log(`  ai     apiUrl: http://127.0.0.1:${PORT}/v1/chat/completions`);
    console.log(`  pages: /  /long?paras=120`);
});

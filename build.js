const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');
const { exit } = require('process');
const { copy } = require('esbuild-plugin-copy');
const glob = require('glob');

// --- 配置常量 ---
const isWatchMode = process.argv.includes('--watch');
const outDir = path.join(__dirname, 'dist');
const srcDir = path.join(__dirname, 'src');
const publicDir = path.join(__dirname, 'public');

// --- 目标浏览器参数解析 ---
let targetBrowser = 'chrome';
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
if (targetArg) {
    targetBrowser = targetArg.split('=')[1];
}
if (!['chrome', 'firefox'].includes(targetBrowser)) {
    console.error(`❌ Invalid target browser: ${targetBrowser}. Must be 'chrome' or 'firefox'.`);
    exit(1);
}

// --- 清理输出目录 ---
try {
    fs.emptyDirSync(outDir);
    console.log('🧹 Cleaned output directory.');
} catch (err) {
    console.error('❌ Failed to clean output directory:', err);
    exit(1);
}

const manifestPlugin = {
    name: 'manifestGenerator',
    setup(build) {
        // 将 manifest 生成逻辑封装成一个可复用函数
        function generateManifest() {
            const manifestBasePath = path.join(publicDir, 'manifest.base.json');
            if (!fs.existsSync(manifestBasePath)) {
                console.error('❌ manifest.base.json not found in public directory.');
                return;
            }
            
            const manifest = fs.readJsonSync(manifestBasePath);

            if (!manifest.background) {
                manifest.background = {};
            }

            if (targetBrowser === 'chrome') {
                delete manifest.browser_specific_settings;
                Object.assign(manifest.background, {
                    service_worker: 'background/service-worker.js',
                });
                delete manifest.background.scripts;
            } else if (targetBrowser === 'firefox') {
                Object.assign(manifest.background, {
                    scripts: ['background/service-worker.js'],
                });
                delete manifest.background.service_worker;
            }

            const manifestOutputPath = path.join(outDir, 'manifest.json');
            fs.writeJsonSync(manifestOutputPath, manifest, { spaces: 2 });
            console.log(`✅ Generated manifest.json for ${targetBrowser}`);
        }

        // 1. 在构建开始时，立即生成一次
        generateManifest();

        // 2. 如果是 watch 模式，则启动自己的监视器
        if (isWatchMode) {
            let rebuildTimeout;
            const manifestPath = path.join(publicDir, 'manifest.base.json');
            fs.watch(manifestPath, (eventType) => {
                if (eventType === 'change') {
                    clearTimeout(rebuildTimeout);
                    // 使用防抖，避免编辑器多次保存事件触发多次生成
                    rebuildTimeout = setTimeout(() => {
                        console.log("\n📄 manifest.base.json changed. Regenerating...");
                        generateManifest();
                    }, 100);
                }
            });
        }
    },
};

// 标准化路径，确保跨平台兼容性
const normalizePath = (p) => p.replace(/\\/g, '/');

const entryPoints = glob.sync(normalizePath(path.join(srcDir, '**', '*.js')), {
    ignore: [
        normalizePath(path.join(srcDir, 'lib', '**', '*')),
        // 你的 subtitle 目录下有一个 .ts 文件，如果它不是入口，也忽略掉
        normalizePath(path.join(srcDir, '**', '*.ts')),
    ],
});

// 修正 copy 插件的 from 路径
const copyPlugin = copy({
    watch: isWatchMode,
    assets: [
        {
            from: 'public/**/*',
            to: '.',
        },
        {
            // 任务1：复制 src 下的 HTML 和 CSS
            from: 'src/**/*.{html,css}',
            to: '.',
        },
        {
            // 任务2：复制 src/lib 下的 JS
            from: 'src/lib/**/*.js',
            to: 'lib/.',
        }
    ],
    verbose: true,
});

// --- esbuild 构建选项 ---
const buildOptions = {
    entryPoints,
    bundle: true,
    outdir: outDir,
    outbase: srcDir,
    platform: 'browser',
    format: 'iife', 
    charset: 'utf8',
    logLevel: 'info',
    sourcemap: isWatchMode ? true : false,
    minify: !isWatchMode,
    treeShaking: true,
    plugins: [
        manifestPlugin,
        copyPlugin,
    ],
};

// --- 执行构建 (逻辑不变) ---
async function run() { /* ... 内容和之前一样，这里省略 ... */ 
    if (entryPoints.length === 0) {
        console.error('❌ No entry points found. Check your `src` directory and glob pattern in `build.js`.');
        exit(1);
    }
    console.log(`Found ${entryPoints.length} entry points to build.`);
    console.log(`🚀 Building for target: ${targetBrowser}${isWatchMode ? ' (watch mode)' : ''}`);

    if (isWatchMode) {
        const context = await esbuild.context(buildOptions);
        await context.watch();
        console.log("👀 Watching for file changes... (Press Ctrl+C to stop)");
        await new Promise(() => {});
    } else {
        await esbuild.build(buildOptions);
        console.log("✅ Build complete.");
    }
}

run().catch((e) => {
    console.error("❌ Build script failed:", e);
    process.exit(1);
});
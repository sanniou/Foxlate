const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');
const { exit } = require('process');
const glob = require('glob');

// --- 配置常量 ---
const isWatchMode = process.argv.includes('--watch');
const outDir = path.join(__dirname, 'dist');
const srcDir = path.join(__dirname, 'src');
const publicDir = path.join(__dirname, 'public');

// --- (新) 将 package.json 作为版本号的唯一真实来源 ---
const packageJson = fs.readJsonSync(path.join(__dirname, 'package.json'));
const version = packageJson.version;

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

console.log(`🚀 Building v${version} for target: ${targetBrowser}${isWatchMode ? ' (watch mode enabled)' : ''}`);

// --- 清理输出目录 ---
try {
    fs.emptyDirSync(outDir);
    console.log('🧹 Cleaned output directory.');
} catch (err) {
    console.error('❌ Failed to clean output directory:', err);
    exit(1);
}

// 在 manifestPlugin 后面添加这个新插件
const staticAssetsManager = {
    name: 'staticAssetsManager',
    setup(build) {
        // --- 定义需要复制的资源 ---
        // 使用 path.join 确保跨平台兼容性
        const assetsToCopy = {
            // key 是源目录, value 是 glob 模式数组
            [publicDir]: ['**/*', '!manifest.base.json'],
            [srcDir]: ['**/*.{html,css}', 'lib/**/*.js'],
        };

        // --- 封装复制函数 ---
        // 参数 inPath 是被修改的文件的绝对路径
        async function copyAsset(inPath) {
            try {
                // 确定文件相对于其源目录 (public/ or src/) 的路径
                let relativePath;
                let sourceBaseDir;

                if (inPath.startsWith(srcDir)) {
                    sourceBaseDir = srcDir;
                } else if (inPath.startsWith(publicDir)) {
                    sourceBaseDir = publicDir;
                } else {
                    return; // 不是我们需要处理的文件
                }

                relativePath = path.relative(sourceBaseDir, inPath);

                // 特别处理 src/lib/ 下的 JS，确保目标路径正确
                // 例如: src/lib/some.js -> dist/lib/some.js
                // 而不是 src/lib/some.js -> dist/src/lib/some.js
                // 我们通过 outbase 实现了这一点，所以这里需要特殊处理一下 toPath
                let toPath;
                if (sourceBaseDir === srcDir && relativePath.startsWith('lib' + path.sep)) {
                    // 如果是 src/lib 内的文件，直接映射到 dist/lib
                    toPath = path.join(outDir, relativePath);
                } else if (sourceBaseDir === srcDir) {
                    // src/ 下的其他文件（如html, css）也直接映射到 dist/
                    toPath = path.join(outDir, relativePath);
                } else {
                    // public/ 下的文件直接映射到 dist/
                    toPath = path.join(outDir, relativePath);
                }


                // 确保目标目录存在
                await fs.ensureDir(path.dirname(toPath));
                await fs.copy(inPath, toPath);
                console.log(`[Static] Copied: ${path.basename(inPath)}`);
            } catch (err) {
                console.error(`[Static] Failed to copy ${path.basename(inPath)}:`, err);
            }
        }

        async function initialCopy() {
            console.log('📦 Performing initial copy of static assets...');
            // 使用 glob.sync 来查找所有匹配的文件
            const publicFiles = glob.sync(path.join(publicDir, '**', '*').replace(/\\/g, '/'), {
                nodir: true,
                ignore: path.join(publicDir, 'manifest.base.json').replace(/\\/g, '/')
            });
            const srcFilesHtmlCss = glob.sync(path.join(srcDir, '**', '*.{html,css}').replace(/\\/g, '/'), { nodir: true });
            const srcFilesLibJs = glob.sync(path.join(srcDir, 'lib', '**', '*.js').replace(/\\/g, '/'), { nodir: true });

            const allFiles = [...publicFiles, ...srcFilesHtmlCss, ...srcFilesLibJs];

            // 并行复制所有文件
            await Promise.all(allFiles.map(file => copyAsset(file)));
            console.log('✅ Initial copy complete.');
        }

        // 1. 在构建开始时，立即执行一次全量复制
        build.onStart(() => {
            // 使用 onStart 钩子，它在每次 esbuild 重建时都会触发
            // 但我们只想在首次构建时执行全量复制，后续由 watch 处理
            // 所以加个标志位
            if (!build.initialBuildDone) {
                initialCopy();
                build.initialBuildDone = true;
            }
        });

        // 2. 如果是 watch 模式，则启动自己的监视器
        if (isWatchMode) {
            // 监视 src 和 public 两个目录
            const watchDirs = [srcDir, publicDir];
            watchDirs.forEach(dir => {
                fs.watch(dir, { recursive: true }, (eventType, filename) => {
                    if (!filename || eventType !== 'change') {
                        return;
                    }
                    const fullPath = path.join(dir, filename);

                    // 检查文件是否是我们关心的类型
                    const isHtmlOrCss = /\.(html|css)$/.test(fullPath);
                    const isLibJs = fullPath.includes(path.join(srcDir, 'lib')) && fullPath.endsWith('.js');
                    const isPublicAsset = fullPath.startsWith(publicDir) && !fullPath.endsWith('manifest.base.json');

                    if (isHtmlOrCss || isLibJs || isPublicAsset) {
                        // 使用防抖来避免编辑器保存时触发多次事件
                        clearTimeout(build.copyTimeout);
                        build.copyTimeout = setTimeout(() => {
                            console.log(`\n📄 Static file changed: ${filename}. Copying...`);
                            copyAsset(fullPath);
                        }, 100);
                    }
                });
            });
            console.log(`👀 Watching for static file changes in [${watchDirs.join(', ')}]...`);
        }
    },
};

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

            // manifest.base.json 是基础，在这里根据目标平台添加特定配置
            const manifest = fs.readJsonSync(manifestBasePath);

            // (新) 从 package.json 自动同步版本号
            manifest.version = version;

            // host_permissions 对于 MV3 两个平台都需要，用于 script 注入和页面访问
            const permissionsToAdd = ["<all_urls>"];
            manifest.host_permissions = permissionsToAdd;

            if (!manifest.background) {
                manifest.background = {};
            }

            if (targetBrowser === 'chrome') {
                // Chrome V3 使用 service_worker
                delete manifest.browser_specific_settings;
                Object.assign(manifest.background, {
                    service_worker: 'background/service-worker.js',
                });
                delete manifest.background.scripts;
            } else if (targetBrowser === 'firefox') {
                // Firefox V3 使用 'scripts'
                Object.assign(manifest.background, {
                    scripts: ['background/service-worker.js'],
                });
                delete manifest.background.service_worker;

                // 为 Firefox 添加 Content Security Policy 以允许连接到外部 API
                manifest.content_security_policy = {
                    // 'extension_pages' 涵盖了背景脚本、弹出窗口和选项页
                    "extension_pages": "script-src 'self'; object-src 'self'; connect-src https: wss:"
                };
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
    ],
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
        staticAssetsManager,
    ],
};

async function run() {
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
        await new Promise(() => { });
    } else {
        await esbuild.build(buildOptions);
        console.log("✅ Build complete.");
    }
}

run().catch((e) => {
    console.error("❌ Build script failed:", e);
    process.exit(1);
});
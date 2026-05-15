const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');
const { exit } = require('process');
const glob = require('glob');
const { exec } = require('child_process');
const https = require('https');

// --- (新增) 依赖库更新检查 ---
const LIBS_TO_CHECK = [
    {
        name: 'browser-polyfill.js',
        type: 'github_release',
        repo: 'mozilla/webextension-polyfill',
        localPath: path.join(__dirname, 'src', 'lib', 'browser-polyfill.js'),
        versionRegex: /webextension-polyfill - v([\d\.]+)/,
    },
    {
        name: 'marked.esm.js',
        type: 'npm',
        packageName: 'marked',
        localPath: path.join(__dirname, 'src', 'lib', 'marked.esm.js'),
        versionRegex: /marked v([\d\.]+)/,
    },
    {
        name: 'readability.esm.js',
        type: 'npm',
        packageName: '@mozilla/readability',
        localPath: path.join(__dirname, 'src', 'lib', 'readability.esm.js'),
        versionRegex: null,
        latestVersionUrl: 'https://unpkg.com/${packageName}@${version}/Readability.js'
    },
    {
        name: 'franc.bundle.mjs',
        type: 'esm_sh',
        packageName: 'franc',
        localPath: path.join(__dirname, 'src', 'lib', 'franc.bundle.mjs'),
        versionRegex: /esm\.sh - franc@([\d\.]+)/,
    },
];

async function getLocalVersion(filePath, regex) {
    if (!regex) {
        return null;
    }
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const match = content.match(regex);
        return match ? match[1] : null;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return 'not found';
        }
        console.error(`❌ Error reading ${path.basename(filePath)}:`, error);
        return null;
    }
}

/**
 * 通用的网络请求函数
 * @param {string|URL} url 请求的 URL
 * @param {object} options 选项, { json: boolean } 表示是否解析为 JSON
 * @returns {Promise<string|object>}
 */
function fetchURL(url, options = {}) {
    return new Promise((resolve, reject) => {
        const requestOptions = {
            headers: { 'User-Agent': 'Node.js', ...options.headers },
        };

        https.get(url, requestOptions, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchURL(res.headers.location, options).then(resolve, reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`请求失败 ${url}: HTTP 状态码 ${res.statusCode}`));
            }

            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    if (options.json) {
                        resolve(JSON.parse(data));
                    } else {
                        resolve(data);
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败 ${url}: ${e.message}`));
                }
            });
        }).on('error', (err) => {
            reject(new Error(`请求失败 ${url}: ${err.message}`));
        });
    });
}

async function getLatestNPMVersion(packageName) {
    const data = await fetchURL(`https://registry.npmjs.org/${packageName}/latest`, { json: true });
    if (!data.version) throw new Error(`在 npm registry 响应中未找到版本号: ${packageName}`);
    return data.version;
}

async function getLatestGitHubRelease(repo) {
    const data = await fetchURL(`https://api.github.com/repos/${repo}/releases/latest`, { json: true });
    if (!data.tag_name) throw new Error(`在 GitHub API 响应中未找到 tag_name: ${repo}`);
    return data.tag_name.replace(/^v/, ''); // 去掉 'v' 前缀
}


async function checkLibraryUpdates() {
    console.log('🔎 Checking for library updates...');
    let updatesFound = false;

    for (const lib of LIBS_TO_CHECK) {
        const localVersion = await getLocalVersion(lib.localPath, lib.versionRegex);
        if (localVersion === 'not found') {
            console.log(`🟡 ${lib.name}: Local file not found. Skipping.`);
            continue;
        }

        try {
            let latestVersion;
            if (lib.type === 'npm') {
                latestVersion = await getLatestNPMVersion(lib.packageName);
            } else if (lib.type === 'github_release') {
                latestVersion = await getLatestGitHubRelease(lib.repo);
            } else if (lib.type === 'esm_sh') {
                // esm.sh 会在 bundle 注释中包含版本号，我们直接从那里提取
                const content = await fetchURL(`https://esm.sh/${lib.packageName}?bundle`);
                const match = content.match(new RegExp(`esm\\.sh - ${lib.packageName}@([\\d\\.]+)`));
                if (!match) throw new Error(`无法从 esm.sh 响应中提取版本: ${lib.packageName}`);
                latestVersion = match[1];
            }

            if (!localVersion) {
                console.log(`🟡 ${lib.name}: Could not determine local version.`);
                if (lib.latestVersionUrl) {
                    const url = lib.latestVersionUrl
                        .replace('${packageName}', lib.packageName)
                        .replace('${version}', latestVersion);
                    console.log(`    Latest version is ${latestVersion}.`);
                    console.log(`    URL: ${url}`);
                }
                continue;
            }


            console.log(`🔄 Checking ${lib.name}: Local version is ${localVersion}, Latest version is ${latestVersion}`);

            if (localVersion !== latestVersion) {
                console.log(`⬆️  Update available for ${lib.name}: ${localVersion} -> ${latestVersion}`);
                updatesFound = true;

                // Special handling for franc: download the latest bundle
                if (lib.type === 'esm_sh' && lib.packageName === 'franc') {
                    console.log(`📥 Downloading latest franc bundle...`);
                    try {
                        const bundleContent = await fetchURL(`https://esm.sh/franc@${latestVersion}/es2022/franc.bundle.mjs`);
                        await fs.writeFile(lib.localPath, bundleContent, 'utf-8');
                        console.log(`✅ Downloaded franc bundle v${latestVersion}`);
                    } catch (error) {
                        console.error(`❌ Failed to download franc bundle: ${error}`);
                    }
                }
            }
        } catch (error) {
            console.error(error);
        }
    }

    if (!updatesFound) {
        console.log('✅ All libraries are up-to-date.');
    }
}

async function main() {
    if (process.argv.includes('--check-updates')) {
        await checkLibraryUpdates();
        return;
    }

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

    const entryPoints = [
        'background/service-worker.js',
        'content/content-script.js',
        'content/subtitle/subtitle-manager.js',
        'content/subtitle/youtube-subtitle-strategy.js',
        'content/subtitle/bilibili-subtitle-strategy.js',
        'options/options.js',
        'popup/popup.js',
    ].map(entry => normalizePath(path.join(srcDir, entry)));

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
        define: {
            '__DEBUG__': String(isWatchMode), // 注入一个全局常量用于调试日志
        },
    };

    // 生产构建时移除 console 和 debugger
    if (!isWatchMode) {
        buildOptions.drop = ['console', 'debugger'];
    }

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

    await run();
}

main().catch((e) => {
    console.error("❌ Build script failed:", e);
    process.exit(1);
});

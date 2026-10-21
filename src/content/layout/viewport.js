/**
 * 视口尺寸读取。
 *
 * 原本 floating-layout-service 与 summary-layout-controller 各写了一份逐字节
 * 相同的实现。集中到这里，两个浮动面板的视口语义保持一致。
 *
 * @returns {{ width: number, height: number }} 视口尺寸，取不到时回退到 1024×768
 */
export function getViewport() {
    return {
        width: window.innerWidth || document.documentElement.clientWidth || 1024,
        height: window.innerHeight || document.documentElement.clientHeight || 768,
    };
}

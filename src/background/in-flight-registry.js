/**
 * 在途请求登记表（single-flight）。
 *
 * 单条翻译路径与 AI 批量路径**共用同一张表**，这是关键：批量路径若绕开这张表，
 * 两个标签页同时翻译同一段文本就会各调一次付费 AI 接口。
 *
 * 占用者拿到 `settle` / `fail` 自行结算；如果占用者不结算（例如把结算权
 * 交给了队列里的批量任务），promise 会一直挂着——这是调用方的责任，不是表的责任。
 */
export class InFlightRegistry {
    #entries = new Map();

    /** 当前在途条数（诊断用）。 */
    get size() {
        return this.#entries.size;
    }

    /**
     * 占用（或复用）某个缓存键的在途请求。
     *
     * @param {string} key
     * @returns {{reused: true, promise: Promise<any>}
     *         | {reused: false, promise: Promise<any>, settle: Function, fail: Function}}
     */
    claim(key) {
        const existing = this.#entries.get(key);
        if (existing) {
            return { reused: true, promise: existing };
        }

        let settle;
        let fail;
        const inner = new Promise((resolve, reject) => {
            settle = resolve;
            fail = reject;
        });

        // tracked 是对外暴露的那个 promise：结算时自动从表中摘除。
        // 用「身份比对」而不是无条件 delete，避免慢速结束的旧项把新项误删。
        const tracked = inner.finally(() => {
            if (this.#entries.get(key) === tracked) {
                this.#entries.delete(key);
            }
        });
        // 允许“无人等待”的在途项（例如批量任务先于任何调用者结束）
        tracked.catch(() => {});

        this.#entries.set(key, tracked);
        return { reused: false, promise: tracked, settle, fail };
    }
}

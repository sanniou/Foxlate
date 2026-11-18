/**
 * 翻译任务调度器：并发额度、排队、中断。
 *
 * 只管「什么时候跑」，不管「跑什么」——入队的是一个返回 promise 的工厂，
 * 工厂收到本任务专属的 AbortSignal。
 *
 * 从 `TranslatorManager` 里拆出来的原因：并发额度与排队是独立的生命周期关注点，
 * 而它原先和 12 项翻译职责混在同一个全静态类里，既无法实例化也无法注入。
 */
export class TranslationTaskScheduler {
    #queue = [];
    /** @type {Map<number, {controller: AbortController, tabId: number|undefined}>} */
    #active = new Map();
    #nextId = 0;
    #maxConcurrent;

    constructor({ maxConcurrent = 5 } = {}) {
        this.#maxConcurrent = maxConcurrent;
    }

    get maxConcurrent() {
        return this.#maxConcurrent;
    }

    get pendingCount() {
        return this.#queue.length;
    }

    get activeCount() {
        return this.#active.size;
    }

    /**
     * 调整并发额度。调大会立即放行排队的任务，调小不会打断已在跑的任务
     * （它们跑完自然退出，直到低于新额度）。
     * @param {unknown} value
     * @returns {boolean} 是否被采纳
     */
    setMaxConcurrent(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return false;
        }
        this.#maxConcurrent = value;
        this.#drain();
        return true;
    }

    /**
     * 入队一个任务。
     *
     * `tabId` 是中断作用域的键：页面上的「还原」只能中断该页面自己的任务。
     * 不记录它的话，`interruptAll()` 是唯一可用的粒度，任何标签页点一下还原都会
     * 把其它标签页付费中的在途翻译一起 abort 掉（它们随后在页面上被渲染成错误标记）。
     *
     * @param {(signal: AbortSignal) => Promise<any>} job
     * @param {{tabId?: number}} [scope]
     * @returns {Promise<any>}
     */
    run(job, { tabId } = {}) {
        return new Promise((resolve, reject) => {
            this.#queue.push({ job, resolve, reject, controller: new AbortController(), tabId });
            this.#drain();
        });
    }

    /**
     * 中断所有待处理与正在进行的任务。
     *
     * 正在跑的任务通过 abort 信号退出（它们随后会在 `finally` 里自行出表）；
     * 还在排队的任务直接 reject——它们从未开始，没有别的机会拿到错误。
     */
    interruptAll() {
        this.#interrupt(() => true);
    }

    /**
     * 只中断给定标签页的任务。
     *
     * 标签页关闭、用户点「还原」都只应影响自己那一页；未带 tabId 的任务不受影响
     * （不知道归属就不能替它下结论）。
     * @param {number} tabId
     */
    interruptTab(tabId) {
        if (tabId === undefined || tabId === null) {
            return;
        }
        this.#interrupt(task => task.tabId === tabId);
    }

    #interrupt(matches) {
        for (const [taskId, task] of this.#active) {
            if (!matches(task)) {
                continue;
            }
            task.controller.abort();
        }

        const remaining = [];
        for (const task of this.#queue) {
            if (!matches(task)) {
                remaining.push(task);
                continue;
            }
            task.controller.abort(); // 标记为中止
            task.reject(new DOMException('Translation was interrupted by the user.', 'AbortError'));
        }
        this.#queue = remaining;
    }

    #drain() {
        while (this.#queue.length > 0 && this.#active.size < this.#maxConcurrent) {
            const task = this.#queue.shift();
            const taskId = this.#nextId++;
            this.#active.set(taskId, { controller: task.controller, tabId: task.tabId });

            (async () => {
                try {
                    task.resolve(await task.job(task.controller.signal));
                } catch (error) {
                    task.reject(error);
                } finally {
                    this.#active.delete(taskId);
                    this.#drain();
                }
            })();
        }
    }
}

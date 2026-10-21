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
     * @param {(signal: AbortSignal) => Promise<any>} job
     * @returns {Promise<any>}
     */
    run(job) {
        return new Promise((resolve, reject) => {
            this.#queue.push({ job, resolve, reject, controller: new AbortController() });
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
        for (const controller of this.#active.values()) {
            controller.abort();
        }

        for (const task of this.#queue) {
            task.controller.abort(); // 标记为中止
            task.reject(new DOMException('Translation was interrupted by the user.', 'AbortError'));
        }
        this.#queue.length = 0;
    }

    #drain() {
        while (this.#queue.length > 0 && this.#active.size < this.#maxConcurrent) {
            const task = this.#queue.shift();
            const taskId = this.#nextId++;
            this.#active.set(taskId, task.controller);

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

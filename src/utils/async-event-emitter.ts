export class AsyncEventEmitter {
    private readonly listener: Record<string, ((...args: any[]) => Promise<void>)[]> = {};
    private readonly transformer: Record<string, ((...args: any[]) => Promise<any[][]>)[]> = {};

    public on(event: string, listener: (...args: any[]) => Promise<void>): void {
        if (this.listener.hasOwnProperty(event)) {
            this.listener[event].push(listener);
        } else {
            this.listener[event] = [listener];
        }
    }

    public async emit(event: string, ...args: any[]): Promise<void> {
        let transformers = this.transformer[event];
        let listeners = this.listener[event];

        let events: any[][] = [args];

        if (transformers) {
            for (let transformer of transformers) {
                let newEvents: any[][] = [];
                for (let current of events) {
                    newEvents.pushAll(await transformer.apply(null, current));
                }
                events = newEvents;
            }
        }
        if (listeners) {
            for (let listener of listeners) {
                for (let current of events) {
                    await listener.apply(null, current);
                }
            }
        }
    }
}

import {IPacket} from 'mqtt';
import {resolve} from 'path';
import {Readable} from 'stream';

import {existsSync, readFileSync} from 'fs';
import {asyncExistsFile, asyncReadFile, asyncWriteFile} from './functions';

export class MqttHardDiskStore {
    private readonly delegate: HardDiskQueue<IPacket>;
    private open: boolean = true;

    public constructor(storeDirectory: string, storeName: string) {
        this.delegate = new HardDiskQueue<any>(storeDirectory, storeName);
    }

    public put(packet: IPacket, cb?: () => void): this {
        if (!this.open) {
            throw new Error('Store closed!');
        }
        this.delegate.push(packet)
            .then(() => {
                if (cb) {
                    cb();
                }
            });
        return this;
    }

    public createStream(): Readable {
        if (!this.open) {
            throw new Error('Store closed!');
        }
        let items = this.delegate.getAllSync();
        let index = 0;
        let destroyed = false;
        return new Readable({
            objectMode: true,
            read() {
                if (destroyed || index >= items.length) {
                    this.push(null);
                    return;
                }
                this.push(items[index++]);
            },
            destroy() {
                if (destroyed) {
                    return;
                }
                destroyed = true;
                process.nextTick(() => this.emit('close'));
            }
        });
    }

    public del(packet: IPacket, cb: (err: Error | null, packet?: IPacket) => void): this {
        if (!this.open) {
            throw new Error('Store closed!');
        }
        this.delegate.delete(entity => entity.messageId === packet.messageId)
            .then(deletedPackets => {
                if (deletedPackets.length === 0) {
                    cb(new Error('missing packet'));
                } else if (deletedPackets.length > 1) {
                    cb(new Error('multiple packets with that id'));
                } else {
                    cb(null, deletedPackets[0]);
                }
            });
        return this;
    }

    public get(packet: IPacket, cb: (err: Error | null, packet?: IPacket) => void): this {
        if (!this.open) {
            throw new Error('Store closed!');
        }
        this.delegate.find(entity => entity.messageId === packet.messageId)
            .then(foundPackets => {
                if (foundPackets.length === 0) {
                    cb(new Error('missing packet'));
                } else if (foundPackets.length > 1) {
                    cb(new Error('multiple packets with that id'));
                } else {
                    cb(null, foundPackets[0]);
                }
            });
        return this;
    }

    public close(cb: () => void): void {
        if (!this.open) {
            throw new Error('Store closed!');
        }
        this.open = false;
        cb();
    }
}

export class HardDiskQueue<TYPE> {
    private readonly queueFile: string;

    public constructor(queueDirectory: string, queueName: string) {
        this.queueFile = resolve(queueDirectory, `${queueName}.json`);
    }

    public async push(entity: TYPE): Promise<void> {
        let queue = await this.readQueue();
        queue.push(entity);
        await this.writeQueue(queue);
    }

    public async poll(): Promise<TYPE | null> {
        let queue = await this.readQueue();
        if (queue.length === 0) {
            return null;
        }
        let entity = queue[0];
        queue.splice(0, 1);
        await this.writeQueue(queue);
        return entity;
    }

    public async delete(predicate: (entity: TYPE) => boolean): Promise<TYPE[]> {
        let queue = await this.readQueue();
        let deleteItems = queue.filter(predicate);
        queue = queue.filter(entity => deleteItems.indexOf(entity) === -1);
        await this.writeQueue(queue);
        return deleteItems;
    }

    public async find(predicate: (entity: TYPE) => boolean): Promise<TYPE[]> {
        let queue = await this.readQueue();
        return queue.filter(predicate);
    }

    public getAllSync(): TYPE[] {
        if (existsSync(this.queueFile)) {
            return JSON.parse(readFileSync(this.queueFile).toString());
        }
        return [];
    }

    private async readQueue(): Promise<TYPE[]> {
        if (await asyncExistsFile(this.queueFile)) {
            return JSON.parse((await asyncReadFile(this.queueFile)).toString());
        }
        return [];
    }

    private async writeQueue(queue: TYPE[]): Promise<void> {
        await asyncWriteFile(this.queueFile, JSON.stringify(queue));
    }
}

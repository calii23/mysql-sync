import {connect as connectMqtt, IClientOptions} from 'mqtt';

import {applicationEvents, DatabaseChange, DatabaseChangeError, DatabaseChangeInfo} from '../application';
import {
    connectedInfoMessageArgsScheme,
    dataReceivedInfoMessageArgsScheme,
    errorInfoMessageArgsScheme,
    infoMessageScheme,
    remoteChangeScheme
} from '../configuration-scheme';
import {asyncReadFile, validateJson} from '../utils/functions';
import {MqttClientWrapper} from '../utils/mqtt-client-wrapper';
import {HardDiskQueue, MqttHardDiskStore} from '../utils/mqtt-hard-disk-store';

export class MqttManager {
    private connectedClients: Record<string, number> = {};
    private nextActiveUpdate: number | null = null;
    private readonly remoteClientQueues: Record<string, HardDiskQueue<QueueItem>> = {};

    private _connection: MqttClientWrapper | null = null;

    public constructor(private readonly clientName: string, private readonly updateInterval: number,
                       private readonly receiveTables: string[], private readonly queueDirectory: string) {
        applicationEvents.on('local-save-successful', this.dataReceived.bind(this));
        applicationEvents.on('local-save-failed', this.error.bind(this));
        applicationEvents.on('remote-send-change', this.sendChange.bind(this));
    }

    public get connection(): MqttClientWrapper {
        if (!this._connection) {
            throw new Error('mqtt manager is not initialized');
        }
        return this._connection;
    }

    public async init(connectionOptions: IClientOptions): Promise<void> {
        let ca: Buffer[] | undefined;
        let cert: Buffer | undefined;
        let key: Buffer | undefined;
        if (typeof connectionOptions.ca === 'string') {
            ca = [await asyncReadFile(connectionOptions.ca)];
        } else if (typeof connectionOptions.ca === 'object' && Array.isArray(connectionOptions.ca)) {
            ca = [];
            for (let caPath of connectionOptions.ca) {
                ca.push(await asyncReadFile(caPath));
            }
        }
        if (typeof connectionOptions.cert === 'string') {
            cert = await asyncReadFile(connectionOptions.cert);
        }
        if (typeof connectionOptions.key === 'string') {
            key = await asyncReadFile(connectionOptions.key);
        }
        this._connection = new MqttClientWrapper(connectMqtt({
            ...connectionOptions,
            incomingStore: new MqttHardDiskStore(this.queueDirectory, 'mqtt-incoming'),
            outgoingStore: new MqttHardDiskStore(this.queueDirectory, 'mqtt-outgoing'),
            will: {
                topic: '/info',
                payload: JSON.stringify({
                    message: 'connection_lost',
                    sender: this.clientName,
                    args: {}
                } as ConnectionLostInfoMessage),
                qos: 1,
                retain: false
            },
            resubscribe: true,
            ca,
            cert,
            key
        }));
        let topics = [
            '/info',
            `/info/${this.clientName}`,
            `/change/${this.clientName}`
        ];
        console.trace('subscribe topic:', topics);
        await this.connection.subscribe(topics);
        this.connection.on('message', this.receivedMessage.bind(this));
        this.connectedClients = {};
    }

    public async tick(): Promise<void> {
        if (!this.connection || !this.connection.connected) {
            return;
        }
        if (!this.nextActiveUpdate || new Date().getTime() > this.nextActiveUpdate) {
            await this.sendConnectedUpdate();
        }
    }

    private async error(data: DatabaseChangeError): Promise<void> {
        console.debug('send error into mqtt', data);
        let payload: ErrorInfoMessage = {
            message: 'error',
            sender: this.clientName,
            args: {
                table: data.table,
                id: data.id,
                date: data.date,
                message: data.message
            }
        };
        await this.publish(`/info/${data.sender}`, payload, data.sender);
    }

    private async dataReceived(data: DatabaseChangeInfo): Promise<void> {
        console.debug('send data received into mqtt', data);
        let payload: DataReceivedInfoMessage = {
            message: 'data_received',
            sender: this.clientName,
            args: {
                table: data.table,
                id: data.id,
                date: data.date
            }
        };
        await this.publish(`/info/${data.sender}`, payload, data.sender);
    }

    private async sendChange(table: string, id: string, entity: SqlEntity, remote: string): Promise<void> {
        console.debug('send data change packet into mqtt');
        await this.publish<DatabaseChange>(`/change/${remote}`, {
            table,
            id,
            entity,
            sender: this.clientName,
            date: new Date().getTime()
        }, remote);
    }

    private isClientConnected(client: string): boolean {
        return this.connectedClients.hasOwnProperty(client) &&
            new Date().getTime() < this.connectedClients[client];
    }

    private async publish<T>(topic: string, payload: T, remoteClient: string | null): Promise<void> {
        if (!this.connection) {
            throw new Error('MQTT is not connected!');
        }
        if (remoteClient && !this.isClientConnected(remoteClient)) {
            if (!this.remoteClientQueues.hasOwnProperty(remoteClient)) {
                this.remoteClientQueues[remoteClient] = new HardDiskQueue<QueueItem>(this.queueDirectory, `remote-${remoteClient}`);
            }
            await this.remoteClientQueues[remoteClient].push({
                topic,
                payload
            });
            return;
        }
        if (remoteClient) {
            console.trace(`publish message in topic '${topic}' for '${remoteClient}'`);
        }
        await this.connection.publish(topic, JSON.stringify(payload));
    }

    private async sendConnectedUpdate(): Promise<void> {
        this.nextActiveUpdate = new Date(new Date().getTime() + this.updateInterval + 2000).getTime();
        let payload: ConnectedInfoMessage = {
            sender: this.clientName,
            message: 'connected',
            args: {
                until: this.nextActiveUpdate + this.updateInterval + 1000
            }
        };
        await this.publish('/info', payload, null);
    }

    private async workRemoteClientQueue(clientName: string): Promise<void> {
        let queueItem: QueueItem | null;
        if (!this.remoteClientQueues.hasOwnProperty(clientName)) {
            this.remoteClientQueues[clientName] = new HardDiskQueue<QueueItem>(this.queueDirectory, `remote-${clientName}`);
        }
        let queue = this.remoteClientQueues[clientName];
        while (queueItem = await queue.poll()) {
            await this.publish(queueItem.topic, queueItem.payload, clientName);
            if (!this.isClientConnected(clientName)) {
                return;
            }
        }
    }

    private async receivedMessage(topic: string, rawPayload: Buffer): Promise<void> {
        let payload = JSON.parse(rawPayload.toString());
        if (topic.startsWith(`/change/${this.clientName}`)) {
            if (!validateJson(payload, remoteChangeScheme, 'remote-change-message')) {
                console.error('received invalid remote change packet', payload);
                return;
            }
            let remoteChange: DatabaseChange = payload;
            if (this.receiveTables.indexOf(remoteChange.table) === -1) {
                console.error('remote client tried to send a row in a table that is not configured as receive table:',
                    remoteChange.table, 'client:', remoteChange.sender);
                await this.error({
                    sender: remoteChange.sender,
                    table: remoteChange.table,
                    id: remoteChange.id,
                    date: remoteChange.date,
                    message: 'The table is not configured as receive table!'
                });
                return;
            }
            console.debug(`received change from '${remoteChange.sender}' for table '${remoteChange.table}'`);
            await applicationEvents.emit('remote-change', remoteChange);
        } else if (topic === '/info' || topic === `/info/${this.clientName}`) {
            if (!validateJson(payload, infoMessageScheme, 'info-message')) {
                console.error('received invalid info packet', payload);
                return;
            }
            let infoMessage: InfoMessage = payload;
            if (infoMessage.sender === this.clientName) {
                return; // abort when receive own info message
            }
            switch (infoMessage.message) {
                case 'connected':
                    if (!validateJson(infoMessage.args, connectedInfoMessageArgsScheme, 'connected-info-message')) {
                        console.error('received invalid info packet', payload);
                        return;
                    }
                    this.connectedClients[infoMessage.sender] = infoMessage.args.until;
                    await this.workRemoteClientQueue(infoMessage.sender);
                    break;
                case 'data_received':
                    if (!validateJson(infoMessage.args, dataReceivedInfoMessageArgsScheme, 'data-received-info-message')) {
                        console.error('received invalid info packet', payload);
                        return;
                    }
                    let dataReceivedMessage = infoMessage as DataReceivedInfoMessage;
                    await applicationEvents.emit('remote-status-change', {
                        ...dataReceivedMessage.args,
                        sender: dataReceivedMessage.sender,
                        status: 'successful'
                    });
                    break;
                case 'error':
                    if (!validateJson(infoMessage.args, errorInfoMessageArgsScheme, 'error-info-message')) {
                        console.error('received invalid info packet', payload);
                        return;
                    }
                    let errorMessage = infoMessage as ErrorInfoMessage;
                    console.debug(`error in client ${errorMessage.sender}: ${errorMessage.args.message}`);
                    await applicationEvents.emit('remote-status-change', {
                        ...errorMessage.args,
                        sender: errorMessage.sender,
                        status: 'error'
                    });
                    break;
                case 'connection_lost':
                    console.warn('client lost connection:', infoMessage.sender);
                    delete this.connectedClients[infoMessage.sender];
                    break;
            }
        }
    }
}

interface InfoMessage {
    sender: string;
    message: string;
    args: { [key: string]: any };
}

interface ConnectedInfoMessage extends InfoMessage {
    message: 'connected';
    args: {
        until: number;
    };
}

interface DataReceivedInfoMessage extends InfoMessage {
    message: 'data_received';
    args: {
        table: string;
        id: string;
        date: number;
    };
}

interface ErrorInfoMessage extends InfoMessage {
    message: 'error';
    args: {
        table: string;
        id: string;
        date: number;
        message: string;
    };
}

interface ConnectionLostInfoMessage extends InfoMessage {
    message: 'connection_lost';
}

interface QueueItem {
    topic: string;
    payload: any;
}

import {
    IClientOptions,
    IClientPublishOptions,
    IClientReconnectOptions,
    IClientSubscribeOptions,
    ISubscriptionGrant,
    MqttClient,
    OnErrorCallback,
    OnMessageCallback,
    OnPacketCallback,
    Packet,
    Store
} from 'mqtt';
import {promisify} from 'util';

export class MqttClientWrapper {
    private _publish = promisify(this.client.publish);
    private _subscribe = promisify(this.client.subscribe);
    private _unsubscribe = promisify(this.client.unsubscribe);
    private _handleMessage = promisify(this.client.handleMessage);

    public constructor(private readonly client: MqttClient) {
    }

    public get connected(): boolean {
        return this.client.connected;
    }

    public get disconnecting(): boolean {
        return this.client.disconnecting;
    }

    public get disconnected(): boolean {
        return this.client.disconnected;
    }

    public get reconnecting(): boolean {
        return this.client.reconnecting;
    }

    public get incomingStore(): Store {
        return this.client.incomingStore;
    }

    public get outgoingStore(): Store {
        return this.client.outgoingStore;
    }

    public get options(): IClientOptions {
        return this.client.options;
    }

    public get queueQoSZero(): boolean {
        return this.client.queueQoSZero;
    }

    public on(event: 'message', cb: OnMessageCallback): this;
    public on(event: 'packetsend' | 'packetreceive', cb: OnPacketCallback): this;
    public on(event: 'error', cb: OnErrorCallback): this;
    public on(event: 'connect', cb: () => void): this;
    public on(event: 'message' | 'packetsend' | 'packetreceive' | 'error' | 'connect' | string, cb: Function): this {
        this.client.on(event, cb);
        return this;
    }

    public once(event: 'message', cb: OnMessageCallback): this;
    public once(event: 'packetsend' | 'packetreceive', cb: OnPacketCallback): this;
    public once(event: 'error', cb: OnErrorCallback): this;
    public once(event: 'connect', cb: () => void): this;
    public once(event: 'message' | 'packetsend' | 'packetreceive' | 'error' | 'connect' | string, cb: Function): this {
        this.client.once(event, cb);
        return this;
    }

    public publish(topic: string, message: string | Buffer, opts?: IClientPublishOptions): Promise<Packet> {
        return this._publish.call(this.client, topic, message, opts);
    }

    public subscribe(topic: string | string[], opts?: IClientSubscribeOptions): Promise<ISubscriptionGrant[]> {
        return this._subscribe.call(this.client, topic, opts);
    }

    public unsubscribe(topic: string | string[]): Promise<Packet> {
        return this._unsubscribe.call(this.client, topic);
    }

    public end(force?: boolean): Promise<void> {
        return new Promise(resolve => this.client.end(force, resolve));
    }

    public removeOutgoingMessage(mid: number): this {
        this.client.removeOutgoingMessage(mid);
        return this;
    }

    public reconnect(opts?: IClientReconnectOptions): this {
        this.client.reconnect(opts);
        return this;
    }

    public handleMessage(packet: Packet): Promise<Packet> {
        return this._handleMessage.call(this.client, packet);
    }

    public getLastMessageId(): number {
        return this.client.getLastMessageId();
    }
}

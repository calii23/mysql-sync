import {
    Connection,
    ConnectionConfig,
    ConnectionOptions,
    createConnection,
    FieldInfo,
    MysqlError,
    QueryOptions
} from 'mysql';
import {promisify} from 'util';

export class MysqlConnectionWrapper {
    public get config(): ConnectionConfig {
        return this.connection.config;
    }

    public get state(): 'connected' | 'authenticated' | 'disconnected' | 'protocol_error' | string {
        return this.connection.state;
    }

    public get threadId(): number | null {
        return this.connection.threadId;
    }

    public static createConnection(config: string | ConnectionConfig): MysqlConnectionWrapper {
        return new MysqlConnectionWrapper(createConnection(config));
    }

    private _connect = promisify(this.connection.connect);
    private _changeUser = promisify(this.connection.changeUser);
    private _beginTransaction = promisify(this.connection.beginTransaction);
    private _commit = promisify(this.connection.commit);
    private _rollback = promisify(this.connection.rollback);
    private _ping = promisify(this.connection.ping);
    private _statistics = promisify(this.connection.statistics);
    private _end = promisify(this.connection.end);

    private constructor(private readonly connection: Connection) {
    }

    public connect(options?: any): Promise<any> {
        return this._connect.call(this.connection, options);
    }

    public changeUser(options?: ConnectionOptions): Promise<void> {
        return this._changeUser.call(this.connection, options);
    }

    public beginTransaction(options?: QueryOptions): Promise<void> {
        return this._beginTransaction.call(this.connection, options);
    }

    public commit(options?: QueryOptions): Promise<void> {
        return this._commit.call(this.connection, options);
    }

    public rollback(options?: QueryOptions): Promise<void> {
        return this._rollback.call(this.connection, options);
    }

    public query(options: string | QueryOptions): Promise<[any[], FieldInfo[]?]> {
        return new Promise<[any[], FieldInfo[]?]>((resolve, reject) => this.connection.query(options, (err, results, fields) => {
            if (err) {
                reject(err);
            } else {
                resolve([results, fields]);
            }
        }));
    }

    public ping(options?: QueryOptions): Promise<void> {
        return this._ping.call(this.connection, options);
    }

    public statistics(options?: QueryOptions): Promise<void> {
        return this._statistics.call(this.connection, options);
    }

    public end(): Promise<any> {
        return this._end.call(this.connection);
    }

    public destroy(): void {
        this.connection.destroy();
    }

    public pause(): void {
        this.connection.pause();
    }

    public resume(): void {
        this.connection.resume();
    }

    public on(ev: 'drain' | 'connect', callback: () => void): this;
    public on(ev: 'end', callback: (err?: MysqlError) => void): this;
    public on(ev: 'fields', callback: (fields: any[]) => void): this;
    public on(ev: 'error', callback: (err: MysqlError) => void): this;
    public on(ev: 'enqueue', callback: (...args: any[]) => void): this;
    public on(ev: string, callback: (...args: any[]) => void): this {
        this.connection.on(ev, callback);
        return this;
    }
}

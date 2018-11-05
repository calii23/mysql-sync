import {ConnectionConfig} from 'mysql';
import {format} from 'sqlstring';

import {applicationEvents} from '../application';
import {MysqlConnectionWrapper} from '../utils/mysql-connection-wrapper';
import {DatabaseConnection} from './database-connection';

export class MysqlDatabaseConnection implements DatabaseConnection<ConnectionConfig> {
    private connection: MysqlConnectionWrapper | null = null;

    public get connected(): boolean {
        return !(!this.connection || (this.connection.state !== 'connected' && this.connection.state !== 'authenticated'));
    }

    public async connect(options: ConnectionConfig): Promise<boolean> {
        if (this.connection) {
            throw new Error('Already connected!');
        }
        this.connection = MysqlConnectionWrapper.createConnection({
            ...options,
            dateStrings: ['TIMESTAMP', 'DATETIME', 'DATE']
        });
        this.connection.on('error', err =>
            applicationEvents.emit('database-error', err)
                .then(() => console.error('error in MySQL connection', err)));
        this.connection.on('end', () => {
            applicationEvents.emit('database-disconnect');
            this.connection = null;
        });
        try {
            await this.connection.connect();
        } catch (error) {
            await applicationEvents.emit('database-error', error);
            console.warn('could not connect MySQL', error);
            return false;
        }
        let connected = await this.testConnection();
        if (connected) {
            await applicationEvents.emit('database-connect');
        }
        return connected;
    }

    public async disconnect(): Promise<void> {
        if (!this.connection) {
            throw new Error('Not connected!');
        }
        await this.connection.end();
    }

    public async query<ROW>(sql: string, ...values: SqlTypes[]): Promise<ROW[]> {
        if (!this.connection || !(await this.testConnection())) {
            throw new Error('MySQL is not connected');
        }

        let statement = format(sql, values);
        try {
            let rawResult = await this.connection!.query(statement);
            return rawResult[0] as ROW[];
        } catch (err) {
            console.error(`error while query the statement '${statement}':`, err);
            throw new Error('could not query the statement!');
        }
    }

    public async testConnection(): Promise<boolean> {
        if (!this.connection || (this.connection.state !== 'connected' && this.connection.state !== 'authenticated')) {
            return false;
        }

        try {
            let result = await this.connection.query('SELECT \'connected\'');
            return result[0][0].connected === 'connected';
        } catch (error) {
            console.warn('MySQL connection lost', error);
            return false;
        }
    }
}

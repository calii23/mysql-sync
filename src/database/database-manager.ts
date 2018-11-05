import {createHash} from 'crypto';
import {applicationEvents, DatabaseChange, DatabaseStatusChange} from '../application';
import {parseSqlDate} from '../utils/functions';
import {HardDiskQueue} from '../utils/mqtt-hard-disk-store';
import {DatabaseConnection} from './database-connection';

// language=SQL
const CREATE_TABLE_CHANGES_TABLE = 'CREATE TABLE IF NOT EXISTS table_changes(' +
    'id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,' +
    '`table_name` VARCHAR(255) NOT NULL,' +
    'primary_key VARCHAR(255) NOT NULL,' +
    '`date` DATETIME NOT NULL)';
// language=SQL
const CREATE_SYNC_STATUS_TABLE = 'CREATE TABLE IF NOT EXISTS sync_status(' +
    'id VARCHAR(32) PRIMARY KEY NOT NULL,' +
    '`table_name` VARCHAR(255) NOT NULL,' +
    'primary_key VARCHAR(255) NOT NULL,' +
    'remote VARCHAR(32) NOT NULL,' +
    '`date` DATETIME NOT NULL,' +
    '`status` ENUM(\'successful\', \'pending\', \'error\') NOT NULL,' +
    'message VARCHAR(255) NULL)';
// language=GenericSQL
const CREATE_UPDATE_TRIGGER = 'CREATE TRIGGER ?? AFTER UPDATE ON ?? FOR EACH ROW ' +
    'INSERT INTO table_changes(`table_name`, primary_key, `date`) VALUE (?, NEW.??, NOW())';
// language=GenericSQL
const CREATE_INSERT_TRIGGER = 'CREATE TRIGGER ?? AFTER INSERT ON ?? FOR EACH ROW ' +
    'INSERT INTO table_changes(`table_name`, primary_key, `date`) VALUE (?, NEW.??, NOW())';
// language=GenericSQL
const CREATE_DELETE_TRIGGER = 'CREATE TRIGGER ?? AFTER DELETE ON ?? FOR EACH ROW ' +
    'INSERT INTO table_changes(`table_name`, primary_key, `date`) VALUE (?, OLD.??, NOW())';
// language=SQL
const NEXT_TABLE_CHANGE = 'SELECT id, `table_name`, primary_key FROM table_changes ORDER BY `date` ASC LIMIT 1';

export class DatabaseManager {
    private readonly cachedPrimaryKeys: { [table: string]: string } = {};
    private readonly queue: HardDiskQueue<DatabaseChange>;

    public constructor(private readonly connection: DatabaseConnection, private readonly connectionOptions: any,
                       private readonly syncTable: string[], private readonly bidirectionalTable: string[], queueDirectory: string) {
        this.queue = new HardDiskQueue<DatabaseChange>(queueDirectory, 'database');
        applicationEvents.on('local-save-change', this.remoteChange.bind(this));
        applicationEvents.on('remote-status-change', this.setStatus.bind(this));
        applicationEvents.on('database-connect', this.workQueue.bind(this));
    }

    public async tick(): Promise<void> {
        if (!(await this.connection.testConnection())) {
            console.info('database is not connected, try to reconnect...');
            if (!(await this.connection.connect(this.connectionOptions))) {
                console.info('database could not be connected');
                return;
            }
            await this.setupDatabase();
        }

        let change = await this.nextChange();
        if (change) {
            await applicationEvents.emit('local-change', change.table, change.id, change.entity);
        }
    }

    private async nextChange(): Promise<{ table: string; entity: SqlEntity, id: string } | null> {
        if (!(await this.connection.testConnection())) {
            return null;
        }
        let tableChangeResult = await this.connection.query<TableChangeRow>(NEXT_TABLE_CHANGE);
        if (tableChangeResult.length === 0) {
            return null;
        }
        let row = tableChangeResult[0];
        console.trace(`found change in table '${row.table_name}'`);
        // language=MySQL
        await this.connection.query('DELETE FROM table_changes WHERE id = ?', row.id);
        // language=GenericSQL
        let primaryKey = await this.getPrimaryKey(row.table_name);
        let entityResult = await this.connection.query('SELECT * FROM ?? WHERE ?? = ?', row.table_name, primaryKey, row.primary_key);
        let entity = entityResult[0] || null;
        return {
            table: row.table_name,
            entity,
            id: row.primary_key
        };
    }

    private async remoteChange(data: DatabaseChange): Promise<void> {
        if (!(await this.connection.testConnection())) {
            await this.queue.push(data);
            await applicationEvents.emit('local-save-failed', {
                sender: data.sender,
                table: data.table,
                id: data.id,
                date: data.date,
                message: 'Could not connect to database'
            });
            return;
        }
        try {
            await this.saveEntity(data);
            await applicationEvents.emit('local-save-successful', {
                sender: data.sender,
                table: data.table,
                id: data.id,
                date: data.date
            });
        } catch (err) {
            await applicationEvents.emit('local-save-failed', {
                sender: data.sender,
                table: data.table,
                id: data.id,
                date: data.date,
                message: err.message
            });
        }
    }

    private async setupDatabase(): Promise<void> {
        console.trace('setup database');
        await this.connection.query(CREATE_TABLE_CHANGES_TABLE);
        await this.connection.query(CREATE_SYNC_STATUS_TABLE);
        console.trace('remove old trigger');
        // language=SQL
        let result = await this.connection.query<TriggerDefinition>('SHOW TRIGGERS WHERE `Trigger` LIKE \'mysqlSync%\'');
        let oldTrigger = result.map(trigger => trigger.Trigger);
        console.trace(`found ${oldTrigger.length} old trigger`);
        for (let trigger of oldTrigger) {
            // language=GenericSQL
            await this.connection.query('DROP TRIGGER ??', trigger);
        }
        for (let table of this.syncTable) {
            console.trace('setup trigger for:', table);
            let primaryKey = await this.getPrimaryKey(table);
            await this.connection.query(CREATE_UPDATE_TRIGGER, `mysqlSyncUpdate_${table}`, table, table, primaryKey);
            await this.connection.query(CREATE_INSERT_TRIGGER, `mysqlSyncInsert_${table}`, table, table, primaryKey);
            await this.connection.query(CREATE_DELETE_TRIGGER, `mysqlSyncDelete_${table}`, table, table, primaryKey);
        }
    }

    private async getPrimaryKey(table: string): Promise<string> {
        if (this.cachedPrimaryKeys.hasOwnProperty(table)) {
            return this.cachedPrimaryKeys[table];
        }
        // language=GenericSQL
        let result = await this.connection.query<{ Field: string }>('SHOW COLUMNS FROM ?? WHERE `Key` = \'PRI\'', table);
        if (result.length === 0) {
            throw new Error(`Table "${table}" does not have a primary key!`);
        }
        let key = result[0].Field;
        this.cachedPrimaryKeys[table] = key;
        return key;
    }

    private async setStatus(data: DatabaseStatusChange): Promise<void> {
        if (!(await this.connection.testConnection())) {
            await this.queue.push({
                sender: '',
                table: 'sync_status',
                id: '',
                date: new Date().getTime(),
                entity: data as any as SqlEntity
            });
            return;
        }
        let {table, id, sender, date, status, message} = data;
        let statusId = DatabaseManager.createStatusId(table, id, sender);
        // language=SQL
        let existingStatus = await this.connection.query<{ date: string }>('SELECT `date` FROM sync_status WHERE id = ?', statusId);
        if (existingStatus.length !== 0 && parseSqlDate(existingStatus[0].date).getTime() > date) {
            return;
        }
        if (existingStatus.length === 0) {
            // language=SQL
            await this.connection.query('INSERT INTO sync_status(id, `table_name`, primary_key, remote, `date`, `status`, message) ' +
                'VALUE (?, ?, ?, ?, ?, ?, ?)', statusId, table, id, sender, new Date(date), status, message || null);
        } else {
            // language=SQL
            await this.connection.query('UPDATE sync_status SET `date` = ?, `status` = ?, message = ? WHERE id = ?',
                new Date(date), status, message || null, statusId);
        }
    }

    private async saveEntity(data: DatabaseChange): Promise<void> {
        let {table, entity, id} = data;
        let primaryKey = await this.getPrimaryKey(table);
        if (entity) {
            if (entity[primaryKey] !== id) {
                await applicationEvents.emit('local-save-failed', {
                    sender: data.sender,
                    table: data.table,
                    id: data.id,
                    date: data.date,
                    message: 'Sent id does not match entity id!'
                });
                return;
            }
            // language=GenericSQL
            let countResult = await this.connection.query('SELECT COUNT(*) FROM ?? WHERE ?? = ?', table, primaryKey, id);
            if (countResult[0]['COUNT(*)'] === 0) {
                let keys = Object.keys(entity);
                let objectAsArray = keys.map(key => entity![key]);
                // language=GenericSQL
                await this.connection.query('INSERT INTO ??(??) VALUE (?)', table, keys, objectAsArray);
            } else {
                // language=GenericSQL
                await this.connection.query('UPDATE ?? SET ? WHERE ?? = ?', table, entity, primaryKey, id);
            }
        } else {
            // language=GenericSQL
            await this.connection.query('DELETE FROM ?? WHERE ?? = ?', table, primaryKey, id);
        }
        if (this.bidirectionalTable.indexOf(table) !== -1) {
            // language=SQL
            await this.connection.query('DELETE FROM table_changes WHERE `table_name` = ? AND primary_key = ?', table, id);
            await applicationEvents.emit('local-change', table, id, entity, data.sender);
        }
    }

    private async workQueue(): Promise<void> {
        let currentItem: DatabaseChange | null;
        while (currentItem = await this.queue.poll()) {
            if (currentItem.table === 'sync_status') {
                await this.setStatus(currentItem.entity as any as DatabaseStatusChange);
            } else {
                await this.saveEntity(currentItem);
            }
            if (!this.connection.connected) {
                return;
            }
        }
    }

    private static createStatusId(table: string, id: string, remote: string): string {
        let hashStream = createHash('md5');
        hashStream.update(`${table}-${id}-${remote}`);
        return hashStream.digest('hex');
    }
}

interface TriggerDefinition {
    Trigger: string;
    Event: string;
    Table: string;
    Statement: string;
    Timing: 'BEFORE' | 'AFTER';
    Created: Date;
    sql_mode: string;
    Definer: string;
    character_set_client: string;
    collation_connection: string;
    'Database Collation': string;
}

interface TableChangeRow {
    id: number;

    table_name: string;

    primary_key: string;
}

interface TableChangeRow {
    id: number;

    table_name: string;

    primary_key: string;
}

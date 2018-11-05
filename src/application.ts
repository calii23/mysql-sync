import {IClientOptions} from 'mqtt';
import {ConnectionConfig} from 'mysql';
import {relative, resolve} from 'path';

import {applicationConfigurationScheme} from './configuration-scheme';
import {DatabaseConnection} from './database/database-connection';
import {MysqlDatabaseConnection} from './database/database-connection-mysql';
import {DatabaseManager} from './database/database-manager';
import {MqttManager} from './mqtt/mqtt';
import {TransformerManager} from './transformer';
import {AsyncEventEmitter} from './utils/async-event-emitter';
import {
    asyncExistsDir,
    asyncMkdir,
    LoggingLevel,
    pathRelativeToFile,
    readJsonFile,
    setupLogger,
    sleep
} from './utils/functions';

export let applicationEvents: ApplicationEvents;

export interface ApplicationEvents {
    // Database Connection

    on(event: 'database-connect' | 'database-disconnect', listener: () => Promise<void>): void;

    on(event: 'database-error', listener: (error: Error) => Promise<void>): void;

    emit(event: 'database-connect' | 'database-disconnect'): Promise<void>;

    emit(event: 'database-error', error: Error): Promise<void>;

    // Database Manager

    on(event: 'local-change', listener: (table: string, id: string, entity: SqlEntity | null, except?: string) => Promise<void>): void;

    on(event: 'local-save-change', listener: (data: DatabaseChange) => Promise<void>): void;

    on(event: 'local-save-successful', listener: (data: DatabaseChangeInfo) => Promise<void>): void;

    on(event: 'local-save-failed', listener: (data: DatabaseChangeError) => Promise<void>): void;

    emit(event: 'local-change', table: string, id: string, entity: SqlEntity | null, except?: string): Promise<void>;

    emit(event: 'local-save-change', data: DatabaseChange): Promise<void>;

    emit(event: 'local-save-successful', data: DatabaseChangeInfo): Promise<void>;

    emit(event: 'local-save-failed', data: DatabaseChangeError): Promise<void>;

    // MQTT Manager

    on(event: 'remote-change', listener: (data: DatabaseChange) => Promise<void>): void;

    on(event: 'remote-send-change', listener: (table: string, id: string, entity: SqlEntity | null, remote: string) => Promise<void>): void;

    on(event: 'remote-status-change', listener: (data: DatabaseStatusChange) => Promise<void>): void;

    emit(event: 'remote-change', data: DatabaseChange): Promise<void>;

    emit(event: 'remote-send-change', table: string, id: string, entity: SqlEntity | null, remote: string): Promise<void>;

    emit(event: 'remote-status-change', data: DatabaseStatusChange): Promise<void>;
}

class Application extends AsyncEventEmitter {
    public constructor(private readonly configuration: ApplicationConfiguration, private readonly configurationFile: string) {
        super();
    }

    public async run(): Promise<never> {
        let databaseConnection: DatabaseConnection = new MysqlDatabaseConnection();
        let queueDirectory = this.configuration.queueDirectory;
        if (!queueDirectory.startsWith('/')) {
            queueDirectory = pathRelativeToFile(this.configuration.queueDirectory, this.configurationFile);
        }
        let bidirectionalTable = this.configuration.receiveTables
            .filter(table => this.configuration.syncTables.indexOf(table) !== -1);
        let databaseManager = new DatabaseManager(databaseConnection, this.configuration.mysqlConfig,
            this.configuration.syncTables, bidirectionalTable, queueDirectory);
        let mqtt = new MqttManager(this.configuration.clientName, this.configuration.checkInterval,
            this.configuration.receiveTables, queueDirectory);
        await mqtt.init(this.configuration.mqttConfig);
        new TransformerManager(this.configuration.transformerDirectory || null, this.configuration.remoteClients,
            this.configuration.clientName, databaseConnection, mqtt.connection);
        while (true) {
            await sleep(this.configuration.checkInterval);
            await databaseManager.tick();
            await mqtt.tick();
        }
    }
}

async function main(): Promise<void> {
    try {
        if (process.argv.length !== 3) {
            let processFile = relative(process.cwd(), process.argv[0]);
            if (!processFile.startsWith('/') && !processFile.startsWith('./')) {
                processFile = `./${processFile}`;
            }
            console.error(`Usage: ${processFile} [config_file]`);
            process.exit(-1);
        }

        let configurationFile = resolve(process.argv[2]);
        console.log('load config file:', configurationFile);
        let applicationConfiguration = await readJsonFile<ApplicationConfiguration>(configurationFile, applicationConfigurationScheme);

        setupLogger(applicationConfiguration.loggingLevel || 'info');

        if (!(await asyncExistsDir(applicationConfiguration.queueDirectory))) {
            await asyncMkdir(applicationConfiguration.queueDirectory);
        }

        if (applicationConfiguration.transformerDirectory && !(await asyncExistsDir(applicationConfiguration.transformerDirectory))) {
            await asyncMkdir(applicationConfiguration.transformerDirectory);
        }

        let application = new Application(applicationConfiguration, configurationFile);
        applicationEvents = application;
        await application.run();
    } catch (error) {
        console.error('error occurred', error);
        process.exit(-2);
    }

}

main()
    .then(() => {
        console.log('application quit unexpected');
        process.exit(-128);
    });

export interface ApplicationConfiguration {
    mqttConfig: IClientOptions;

    mysqlConfig: ConnectionConfig;

    syncTables: string[];

    receiveTables: string[];

    clientName: string;

    remoteClients: string[];

    queueDirectory: string;

    loggingLevel?: LoggingLevel;

    checkInterval: number;

    transformerDirectory?: string;
}

export interface DatabaseChangeInfo {
    sender: string;
    table: string;
    id: string;
    date: number;
}

export interface DatabaseChange extends DatabaseChangeInfo {
    entity: SqlEntity | null; // null when the row has been deleted
}

export interface DatabaseChangeError extends DatabaseChangeInfo {
    message: string;
}

type Status = 'successful' | 'pending' | 'error';

export interface DatabaseStatusChange extends DatabaseChangeInfo {
    status: Status;

    message?: string;
}

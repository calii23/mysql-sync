import {resolve} from 'path';

import {applicationEvents, DatabaseChange} from './application';
import {DatabaseConnection} from './database/database-connection';
import {asyncExistsFile} from './utils/functions';
import {MqttClientWrapper} from './utils/mqtt-client-wrapper';

const toCamelCase = require('to-camel-case');

export class TransformerManager {
    private readonly cachedTransformer: { [table: string]: Transformer | null } = {};

    public constructor(private readonly transformerDirectory: string | null, private readonly remoteClients: string[],
                       private readonly clientName: string, private database: DatabaseConnection,
                       private readonly mqtt: MqttClientWrapper) {
        applicationEvents.on('local-change', this.onLocalChange.bind(this));
        applicationEvents.on('remote-change', this.onRemoteChange.bind(this));
    }

    private async onLocalChange(table: string, id: string, entity: SqlEntity | null, except?: string): Promise<void> {
        for (let client of this.remoteClients) {
            if (client === except) {
                continue;
            }
            console.trace('transform for', client);
            let transformedEntity = await this.transformEntity(table, entity, this.clientName, client);
            await applicationEvents.emit('remote-send-change', table, id, transformedEntity, client);
        }
    }

    private async onRemoteChange(data: DatabaseChange): Promise<void> {
        console.trace('transform incoming change');
        let transformedEntity = await this.transformEntity(data.table, data.entity, data.sender, this.clientName);
        let transformedData: DatabaseChange = {
            ...data,
            entity: transformedEntity
        };
        await applicationEvents.emit('local-save-change', transformedData);
    }

    private async transformEntity(table: string, entity: SqlEntity | null, source: string, target: string): Promise<SqlEntity | null> {
        let transformer = await this.findTransformer(table);
        if (transformer) {
            let context: TransformerContext = {
                entity,
                source,
                target,
                database: this.database,
                mqtt: this.mqtt
            };
            let transformerResult = transformer(context);
            if (!transformerResult) {
                return null;
            }
            if (transformerResult.hasOwnProperty('then') && transformerResult.hasOwnProperty('catch')) {
                transformerResult = await transformerResult;
            }
            return transformerResult;
        } else {
            return entity;
        }
    }

    private async findTransformer(table: string): Promise<Transformer | null> {
        if (!this.transformerDirectory) {
            return null;
        }
        if (this.cachedTransformer.hasOwnProperty(table)) {
            return this.cachedTransformer[table];

        }
        let filePath = resolve(this.transformerDirectory, `${toCamelCase(table)}.js`);
        let transformer: Transformer | null;
        if (await asyncExistsFile(filePath)) {
            transformer = require(filePath);
            if (typeof transformer !== 'function') {
                console.error(`invalid transformer in file "${filePath}"! A transformer file must export a function found: "${typeof transformer}"`);
                transformer = null;
            }
        } else {
            transformer = null;
        }
        this.cachedTransformer[table] = transformer;
        return transformer;
    }
}

type Transformer = (context: TransformerContext) => Promise<SqlEntity | null> | SqlEntity | null;

interface TransformerContext {
    entity: SqlEntity | null;

    source: string;

    target: string;

    database: DatabaseConnection;

    mqtt: MqttClientWrapper;
}

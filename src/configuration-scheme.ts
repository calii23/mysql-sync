import {Schema} from 'jsonschema';

const definitions: { [name: string]: Schema } = {
    host: {
        type: 'string',
        format: 'hostname'
    },
    port: {
        type: 'number',
        minimum: 0,
        maximum: 65535
    },
    clientName: {
        type: 'string',
        // language=JSRegexp
        pattern: '^[a-zA-Z0-9-_]{2,32}$'
    },
    tableName: {
        type: 'string',
        minLength: 1,
        maxLength: 128
    },
    date: {
        type: 'number',
        minimum: new Date().getTime()
    },
    stringOrStringArray: {
        type: [
            'string',
            'array'
        ],
        items: {
            type: 'string'
        },
        uniqueItems: true
    },
    stringOrObjectArray: {
        type: [
            'string',
            'array'
        ],
        items: {
            type: 'object'
        },
        uniqueItems: true
    },
    nonEmptyString: {
        type: 'string',
        minLength: 1
    }
};

export const applicationConfigurationScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        mqttConfig: {
            type: 'object',
            definitions: {
                protocol: {
                    type: 'string',
                    enum: [
                        'wss',
                        'ws',
                        'mqtt',
                        'mqtts',
                        'tcp',
                        'ssl',
                        'wx',
                        'wxs'
                    ]
                },
                qos: {
                    type: 'number',
                    enum: [
                        0,
                        1,
                        2
                    ]
                }
            },
            properties: {
                host: {
                    $ref: '#/definitions/host'
                },
                port: {
                    $ref: '#/definitions/port'
                },
                hostname: {
                    type: 'string',
                    format: 'hostname'
                },
                path: {
                    type: 'string'
                },
                protocol: {
                    $ref: '#/properties/mqttConfig/definitions/protocol'
                },
                wsOptions: {
                    type: 'object'
                },
                keepalive: {
                    type: 'number',
                    minimum: 0
                },
                clientId: {
                    type: 'string'
                },
                protocolId: {
                    type: 'string'
                },
                protocolVersion: {
                    type: 'number'
                },
                clean: {
                    type: 'boolean',
                },
                reconnectPeriod: {
                    type: 'number',
                    minimum: 0
                },
                connectTimeout: {
                    type: 'number',
                    minimum: 0
                },
                username: {
                    type: 'string'
                },
                password: {
                    type: 'string'
                },
                queueQoSZero: {
                    type: 'boolean'
                },
                reschedulePings: {
                    type: 'boolean'
                },
                servers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            host: {
                                $ref: '#/definitions/host'
                            },
                            port: {
                                $ref: '#/definitions/port'
                            },
                            protocol: {
                                $ref: '#/properties/mqttConfig/definitions/protocol'
                            }
                        },
                        required: [
                            'host',
                            'port'
                        ]
                    },
                    uniqueItems: true
                },
                resubscribe: {
                    type: 'boolean'
                },
                will: {
                    type: 'object',
                    properties: {
                        topic: {
                            type: 'string'
                        },
                        payload: {
                            type: 'string'
                        },
                        qos: {
                            $ref: '#/properties/mqttConfig/definitions/qos'
                        },
                        retain: {
                            type: 'boolean'
                        }
                    },
                    required: [
                        'topic',
                        'payload',
                        'qos',
                        'retain'
                    ]
                },
                key: {
                    type: [
                        'string',
                        'array'
                    ],
                    items: {
                        type: [
                            'string',
                            'object'
                        ]
                    },
                    uniqueItems: true
                },
                cert: {
                    $ref: '#/definitions/stringOrStringArray',
                },
                ca: {
                    $ref: '#/definitions/stringOrStringArray',
                },
                rejectUnauthorized: {
                    type: 'boolean'
                }
            }
        },
        mysqlConfig: {
            type: 'object',
            properties: {
                host: {
                    $ref: '#/definitions/host'
                },
                port: {
                    $ref: '#/definitions/port'
                },
                user: {
                    type: 'string'
                },
                password: {
                    type: 'string'
                },
                database: {
                    type: 'string'
                },
                charset: {
                    type: 'string'
                },
                localAddress: {
                    type: 'string',
                    format: 'ipv4'
                },
                socketPath: {
                    type: 'string',
                    format: 'uri'
                },
                timezone: {
                    type: 'string'
                },
                connectTimeout: {
                    type: 'integer'
                },
                stringifyObjects: {
                    type: 'boolean'
                },
                insecureAuth: {
                    type: 'boolean'
                },
                supportBigNumbers: {
                    type: 'boolean'
                },
                bigNumberStrings: {
                    type: 'boolean'
                },
                dateStrings: {
                    type: [
                        'string',
                        'boolean'
                    ],
                    enum: [
                        false,
                        true,
                        'TIMESTAMP',
                        'DATETIME',
                        'DATE'
                    ]
                },
                debug: {
                    type: [
                        'array',
                        'boolean'
                    ],
                    items: {
                        type: 'string'
                    },
                    uniqueItems: true
                },
                trace: {
                    type: 'boolean'
                },
                multipleStatements: {
                    type: 'boolean'
                },
                flags: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                    uniqueItems: true
                },
                ssl: {
                    type: [
                        'string',
                        'object'
                    ],
                    properties: {
                        pfx: {
                            type: [
                                'string',
                                'array'
                            ],
                            items: {
                                type: [
                                    'string',
                                    'object'
                                ]
                            },
                            uniqueItems: true
                        },
                        key: {
                            type: [
                                'string',
                                'array'
                            ],
                            items: {
                                type: 'object'
                            },
                            uniqueItems: true
                        },
                        passphrase: {
                            type: 'string'
                        },
                        cert: {
                            $ref: '#/definitions/stringOrStringArray'
                        },
                        ca: {
                            $ref: '#/definitions/stringOrStringArray'
                        },
                        ciphers: {
                            type: 'string'
                        },
                        honorCipherOrder: {
                            type: 'boolean'
                        },
                        ecdhCurve: {
                            type: 'string'
                        },
                        clientCertEngine: {
                            type: 'string'
                        },
                        crl: {
                            $ref: '#/definitions/stringOrStringArray'
                        },
                        dhparam: {
                            type: 'string'
                        },
                        secureOptions: {
                            type: 'integer'
                        },
                        secureProtocol: {
                            type: 'string'
                        },
                        sessionIdContext: {
                            type: 'string'
                        },
                        rejectUnauthorized: {
                            type: 'boolean'
                        }
                    }
                }
            }
        },
        clientName: {
            $ref: '#/definitions/clientName'
        },
        remoteClients: {
            type: 'array',
            items: {
                $ref: '#/definitions/clientName'
            }
        },
        syncTables: {
            type: 'array',
            items: {
                $ref: '#/definitions/tableName'
            },
            uniqueItems: true
        },
        receiveTables: {
            type: 'array',
            items: {
                $ref: '#/definitions/tableName'
            },
            uniqueItems: true
        },
        queueDirectory: {
            $ref: '#/definitions/nonEmptyString',
            format: 'url'
        },
        loggingLevel: {
            type: 'string',
            enum: [
                'error',
                'warn',
                'info',
                'debug',
                'trace'
            ]
        },
        checkInterval: {
            type: 'number',
            minimum: 1
        },
        transformerDirectory: {
            type: 'string',
            format: 'url'
        }
    },
    required: [
        'mqttConfig',
        'mysqlConfig',
        'syncTables',
        'receiveTables',
        'clientName',
        'remoteClients',
        'queueDirectory',
        'checkInterval'
    ],
    additionalProperties: false
};

export const remoteChangeScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        sender: {
            $ref: '#/definitions/clientName'
        },
        table: {
            $ref: '#/definitions/tableName'
        },
        id: {
            $ref: '#/definitions/nonEmptyString'
        },
        date: {
            $ref: '#/definitions/date'
        },
        entity: {
            type: [
                'object',
                'null'
            ]
        }
    },
    required: [
        'sender',
        'table',
        'entity'
    ],
    additionalProperties: false
};

export const infoMessageScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        sender: {
            $ref: '#/definitions/clientName'
        },
        message: {
            type: 'string',
            enum: [
                'connected',
                'data_received',
                'error',
                'connection_lost'
            ]
        },
        args: {
            type: 'object'
        }
    },
    required: [
        'sender',
        'message',
        'args'
    ],
    additionalProperties: false
};

export const connectedInfoMessageArgsScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        until: {
            $ref: '#/definitions/date'
        }
    },
    required: [
        'until'
    ],
    additionalProperties: false
};

export const dataReceivedInfoMessageArgsScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        table: {
            $ref: '#/definitions/tableName'
        },
        id: {
            $ref: '#/definitions/nonEmptyString',
        },
        date: {
            $ref: '#/definitions/date',
        }
    },
    required: [
        'table',
        'id',
        'date'
    ],
    additionalProperties: false
};

export const errorInfoMessageArgsScheme: Schema = {
    type: 'object',
    definitions,
    properties: {
        table: {
            $ref: '#/definitions/tableName'
        },
        id: {
            $ref: '#/definitions/nonEmptyString',
        },
        date: {
            $ref: '#/definitions/date',
        },
        message: {
            $ref: '#/definitions/nonEmptyString',
        }
    },
    additionalProperties: false
};

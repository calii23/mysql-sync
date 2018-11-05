# mysql-sync
## Build
```bash
npm run build
```
## Usage
```bash
mysql-sync configuration.json
```
## Configuration
The configuration file must be a JSON (see `ApplicationConfiguration` in `src/application.ts`)
## MQTT
The MQTT is used to sync table changes between the clients. Any messages are in the JSON format.
### Topics
The following topics are used
#### /info
This topic is used to send information to the all client. The definition for a message in this topic:
```typescript
interface InfoMessage {
    sender: string;
    message: string;
    args: {[key: string]: any};
}

interface ConnectedInfoMessage extends InfoMessage {
  message: 'connected';
  args: {
      until: number
  }
}

interface ConnectionLostInfoMessage extends InfoMessage {
    message: 'connection_lost';
}
```
For example:
```json
{
  "sender": "{client_name}",
  "message": "connected",
  "args": {
    "until": "{timestamp for next update}"
  }
}
```
or
```json
{
  "sender": "{client_name}",
  "message": "connection_lost",
  "args": {}
}
```
This message should be the `will` message that is automatically send when a client lost
the connection.
#### /info/{client_name}
This topic is used to send information to the a specific client. The definition
for a message in this topic:
```typescript
interface InfoMessage {
    sender: string;
    message: string;
    args: {[key: string]: any};
}

interface DataReceivedInfoMessage extends InfoMessage {
  message: 'data_received';
  args: {
      table: string;
      id: string;
      date: number;
  }
}

interface ErrorInfoMessage extends InfoMessage {
  message: 'error';
  args: {
      table: string;
      id: string;
      date: Date;
      message: string;
  }
}
```
For example:
```json
{
  "sender": "{client_name}",
  "message": "data_received",
  "args": {
    "table": "{table_name}",
    "id": "2055d5d7-21e9-410b-954e-bb65772d9c6e",
    "date": "{timestamp when the data where received}"
  }
}
```
or
```json
{
  "sender": "{client_name}",
  "message": "error",
  "args": {
    "table": "{table_name}",
    "id": "89938513-8988-42a5-97ed-d941fd4f50c3",
    "date": "{timestamp when the data where received}",
    "message": "Database connection timed out!"
  }
}
```
#### /change/{client_name}
This topic is used to send a table change to a specific client. This topic must only used when
the client is online. For example:
```json
{
  "sender": "{sender_name}",
  "table": "{table_name}",
  "id": "53d21975-608f-40a5-b97b-02d4ad7b1f71",
  "date": 123,
  "entity": {
    "id": "53d21975-608f-40a5-b97b-02d4ad7b1f71",
    "name": "Some name"
  }
}
```
### Setup
Any server that supports MQTT with one of the following protocols are supported:
* wss
* ws
* mqtt
* mqtts
* tcp
* ssl
* wx
* wxs
### Secure Mosquitto
#### Create Certificates
```bash
openssl genrsa -out ca.key 4096 # create authority key
openssl req -new -x509 -days 365 -key ca.key -out ca.crt # create authority certificate
openssl genrsa -out server.key 4096 # create server key
openssl req -new -key server.key -out server.crs # create server certificate
openssl x509 -req -CA ca.crt -CAkey ca.key -CAcreateserial \
 -days 365 -in server.crs -out server.crt # sign server certificate
mkdir /etc/mosquitto/certs # maybe this directory already exists
cp ca.crt server.key server.crt /etc/mosquitto/certs/ # copy the certificates
```
#### Configure Mosquitto
Open the file `/etc/mosquitto/mosquitto.conf` and set the following properties:
```
port 8883

#capath
cafile /etc/mosquitto/certs/ca.crt
keyfile /etc/mosquitto/certs/server.key
certfile /etc/mosquitto/certs/server.crt
tls_version tlsv1.3
```
#### Configure mysql-sync
You need to configure the `mqttConfig` property in the configuration JSON as the following:
```json
{
  "host": "{remote_host}",
  "port": 8883,
  "protocol": "ssl",
  "ca": "ca.crt",
  "cert": "client.crt"
}
```
#### optional: configure password
To configure a run:
```bash
mosquitto_passwd -c /etc/mosquitto/passwordfile client_name # for the first client
mosquitto_passwd /etc/mosquitto/passwordfile client_name # for ever next client
```
And add the following property to file `/etc/mosquitto/mosquitto.conf`:
```
password_file /etc/mosquitto/passwordfile
```
Then just add `username` and `password` properties to the mysql-sync configuration.
## MySQL
Triggers are created in the database to watch table changes. After the database is connected
all triggers which name starts with `mysqlSync` will deleted. Then for each table in the `syncTables`
list, three trigger will created. One to listen for updates, one for listen for inserts and
one to listen for deletes. After the database is connected a table named `table_changes` and
a table named `sync_status`. The table name `table_changes` is used to watch table changes.
The triggers they are created to watch table changes inserts a row when a table row changes.
The table named `sync_status` can be used to show the sync status in external applications.
The DDL for the of that table is:
```SQL
CREATE TABLE sync_status(
    id VARCHAR(32) PRIMARY KEY NOT NULL,
    `table_name` VARCHAR(255) NOT NULL,
    primary_key VARCHAR(255) NOT NULL,
    remote VARCHAR(32) NOT NULL,
    `date` DATETIME NOT NULL,
    `status` ENUM('successful', 'pending', 'error') NOT NULL,
    message VARCHAR(255) NULL
)
```
The id is generated with
```js
md5(table + '-' + id + '-' + remote);
```
## Transformer
Transformer can be used to change a entity before sending it to MQTT or before writing it into
database. A transformer is a JavaScript file with one export.

A transformer must have one argument: `context` and must return the entity or a Promise that
resolves the entity.
### Transformer Context
The argument `context` is a object with the following keys:
#### entity
The untransformed entity as a object.
#### source
The client name the change came from (when from local database then this will be
the client name of the current instance).
#### target
The client name the change goes to (when from remote database then this will be
the client name of the current instance).
#### database
The connection to the SQL database. The only function that should used is `query`. That function
accepts a SQL template (see `sqlstring`) and then a vararg with the parameter for the template.
The function returns a Promise that resolves an array with the rows that the statement has been
returned. The function signature:
```typescript
declare type SqlType = boolean | number | Date | Buffer | string | { toSqlString(): any };
declare type SqlTypes = SqlType | SqlType[];
declare function query<ROW = { [key: string]: any }>(sql: string,
                                                     ...values: SqlTypes[]): Promise<ROW[]>;
```
### mqtt
The connection to the MQTT. The only function that should used is `publish`. The function signature:
```typescript
interface IClientPublishOptions {
  /**
   * the QoS
   */
  qos: 0 | 1 | 2
  /**
   * the retain flag
   */
  retain?: boolean
  /**
   * whether or not mark a message as duplicate
   */
  dup?: boolean
}
interface Packet {
  cmd: string;
  messageId?: number;
  length?: number;
}
declare function publish(topic: string, message: string | Buffer,
                                        opts?: IClientPublishOptions): Promise<Packet>;
```
### Example
`productItems.js`
```javascript
async function transformer(context) {
    // language=SQL
    let databaseResult = await context.mysql.query('SELECT id FROM id_mapping WHERE id = ?',
                                                    context.entity.id);
    if (databaseResult.length > 0) {
        context.entity.id = databaseResult[0].id;
    }
    return context.entity;
}
module.exports = transformer;
```
This transformer will match to all tables that are name `productItems` in camel case,
e.g. `product_items`, `product-items`, `product items`, ...(see `to-camel-case`)
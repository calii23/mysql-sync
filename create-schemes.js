// This file can be used to generate JSON schemes
// to import them into the IDE.
const fs = require('fs');
const schemes = require('./dist/configuration-scheme');

if (!fs.existsSync('schemes')) {
    fs.mkdirSync('schemes');
}
fs.writeFileSync('schemes/application-configuration.json', JSON.stringify(schemes.applicationConfigurationScheme, null, 4));
fs.writeFileSync('schemes/queue.json', JSON.stringify(schemes.queueScheme, null, 4));

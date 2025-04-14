// logger.js
const bunyan = require('bunyan');

const logger = bunyan.createLogger({
    name: 'almatools',
    streams: [
        {
            type: 'rotating-file',
            level: 'info',
            path: 'app.log',
            period: '1d',
            count: 7
        },
        {
            type: 'rotating-file',
            level: 'error',
            path: 'error.log',
            period: '1d',
            count: 7
        },
        {
            level: 'debug',
            stream: process.stdout
        }
    ]
});

module.exports = logger;

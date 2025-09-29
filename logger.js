require('dotenv').config({path:'almatools-tasks.env'})

const winston = require('winston');
require('winston-daily-rotate-file');

const path = require('path');

const logDir = path.resolve(__dirname, 'logs');

const level = process.env.LOG_LEVEL || 'info';

const infoTransport = new winston.transports.DailyRotateFile({
    filename: 'app-%DATE%.log',
    dirname: logDir,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxFiles: '7d',
    level: 'info',
});


const errorTransport = new winston.transports.DailyRotateFile({
    filename: 'error-%DATE%.log',
    dirname: logDir,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxFiles: '14d',
    level: 'error',
});


const consoleTransport = new winston.transports.Console({
    level: level,
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
    )
});

const logger = winston.createLogger({
    level: level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
        })
    ),
    transports: [
        infoTransport,
        errorTransport,
        consoleTransport
    ]
});

module.exports = logger;

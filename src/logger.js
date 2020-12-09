const winston = require('winston');

const { createLogger, format, transports } = winston;

module.exports = createLogger({
    level: 'info',
    format: format.combine(
        format.splat(),
        format.colorize(),
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [new transports.Console()],
});

const Discord = require('discord.js');
const winston = require('winston');
const npid = require('npid');

const config = require('./config');
const replay = require('./replay');
const unit = require('./unit');

winston.level = 'debug';

winston.info('Launching...');

if (config.bot.pid_file) {
    winston.info(`Creating PID file: ${config.bot.pid_file}`);
    try {
        const pid = npid.create(config.bot.pid_file);
        pid.removeOnExit();
    } catch (e) {
        winston.error(e);
        process.exit(1);
    }
}

const client = new Discord.Client();

client.on('ready', () => {
    winston.info('Ready.');
});

client.on('message', message => {
    if (message.system || message.author.bot) {
        return;
    }
    if (message.channel instanceof Discord.DMChannel) {
        winston.info(`Private message from ${message.author.tag}: ${message.content}`);
        if (message.content === 'ping') {
            message.reply('pong');
            return;
        }
    }

    replay.handleMessage(message);
    unit.handleMessage(message);
});

client.on('reconnecting', () => {
    winston.info('Reconnecting.');
});

client.on('disconnect', () => {
    winston.info('Disconnected. Shutting down.');
    process.exit();
});

client.on('debug', info => {
    winston.debug('Client:', info);
});

client.on('warn', info => {
    winston.warn('Client:', info);
});

client.on('error', error => {
    winston.error('Client:', error);
});

client.login(config.bot.login_token);

process.on('SIGINT', () => {
    winston.warn('Caught interrupt signal.');
    if (client.readyAt !== undefined && client.readyAt !== null) {
        client.destroy();
    } else {
        process.exit();
    }
});

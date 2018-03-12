const Discord = require('discord.js');
const fs = require('fs');
const toml = require('toml');
const winston = require('winston');

const replay = require('./replay');

winston.level = 'debug';

winston.info('Launching...');

const config = toml.parse(fs.readFileSync('bot.toml'));

const client = new Discord.Client();

client.on('ready', () => {
    winston.info('Ready.');
});

client.on('message', message => {
    if (message.system || message.author.bot) {
        return;
    }
    if (message.channel instanceof Discord.DMChannel) {
        winston.info('Private message from ' + message.author.tag + ': ' + message.content);
        if (message.content === 'ping') {
            message.reply('pong');
        }
        return;
    }

    replay.handleMessage(message);
});

client.on('reconnecting', () => {
    winston.info('Reconnecting.');
});

client.on('disconnect', event => {
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

client.login(config.login.token);

process.on('SIGINT', () => {
    winston.warn('Caught interrupt signal.');
    if (client.readyAt != null) {
        client.destroy();
    } else {
        process.exit();
    }
});

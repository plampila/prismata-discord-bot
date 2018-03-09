const Discord = require('discord.js');
const fs = require('fs');
const toml = require('toml');
const winston = require('winston');

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

    if (message.content === '!ping') {
        message.reply('pong');
    }
});

client.on('reconnecting', () => {
    winston.info('Reconnecting.');
});

client.on('disconnect', event => {
    winston.info('Disconnected. Shutting down.');
    process.exit();
});

client.on('warn', info => {
    winston.warn('Warn:', info);
});

client.on('error', error => {
    winston.error('Error:', error);
});

client.login(config.login.token);

process.on('SIGINT', function() {
    winston.warn("Caught interrupt signal.");
    if (client.readyAt != null) {
        client.destroy();
    } else {
        process.exit();
    }
});

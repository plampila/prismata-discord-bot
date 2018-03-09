const winston = require('winston');

const codeRegexp = /[a-zA-Z0-9@+]{5}-[a-zA-Z0-9@+]{5}/g;

module.exports.handleMessage = function handleMessage(message) {
    var matches = message.content.match(codeRegexp);
    if (!matches) {
        return;
    }

    message.reply('Found ' + matches.length + ' replay codes.');
};

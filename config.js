const fs = require('fs');
const toml = require('toml');

module.exports = Object.freeze(toml.parse(fs.readFileSync('bot.toml')));

const assert = require('assert');
const Discord = require('discord.js');
const fs = require('fs');
const toml = require('toml');
const winston = require('winston');

const unitSearchRegexp = /\[\[([\w ]+)\]\]/g;

const config = toml.parse(fs.readFileSync('bot.toml'));
const unitData = JSON.parse(fs.readFileSync('units.json'));
const unitAliases = collectUnitAliases();

var channelIgnores = {};

function collectUnitAliases() {
    var aliases = {};

    Object.keys(unitData).forEach(unit => {
        aliases[unit.toUpperCase()] = unit;
    });
    Object.keys(unitData).forEach(unit => {
        if (unit.indexOf(' ') === -1) {
            return;
        }
        unit.split(' ').forEach(part => {
            if (config.unit.ignored_aliases.includes(part.toUpperCase())) {
                return;
            }
            if (!aliases[part.toUpperCase()]) {
                aliases[part.toUpperCase()] = [];
            }
            if (aliases[part.toUpperCase()] instanceof Array) {
                aliases[part.toUpperCase()].push(unit);
            }
        });
    });
    Object.keys(aliases).forEach(unit => {
        if (aliases[unit] instanceof Array) {
            if (aliases[unit].length === 1) {
                aliases[unit] = aliases[unit][0];
            } else {
                delete aliases[unit];
            }
        }
    });

    return aliases;
}

function createEmbed(unit, supply) {
    var embed = new Discord.RichEmbed({
        image: {
            url: config.unit.image_url.replace('%NAME%', encodeURIComponent(unit)),
            width: 453,
            height: 217,
        },
    });
    embed.setColor('BLUE');
    embed.setTitle(unit);
    embed.setURL(config.unit.link_url.replace('%NAME%', encodeURIComponent(unit)));
    embed.setFooter('Supply: ' + supply);
    return embed;
}

function filterIgnored(channel, codes) {
    const cutoffTime = Date.now() - config.unit.ignore_duplicate_time * 1000;

    if (!channelIgnores.hasOwnProperty(channel)) {
        channelIgnores[channel] = {};
    }
    Object.keys(channelIgnores[channel]).forEach(code => {
        if (channelIgnores[channel][code] < cutoffTime) {
            delete channelIgnores[channel][code];
        }
    });

    return codes.filter(code => {
        return !channelIgnores[channel].hasOwnProperty(code);
    });
}

function updateIgnored(channel, codes) {
    const time = Date.now();

    if (!channelIgnores.hasOwnProperty(channel)) {
        channelIgnores[channel] = {};
    }
    codes.forEach(code => {
        channelIgnores[channel][code] = time;
    });
}

function channelName(channel) {
    if (channel instanceof Discord.TextChannel) {
        return channel.guild.name + ' #' + channel.name;
    } else if (channel instanceof Discord.DMChannel) {
        return 'DM';
    } else if (channel instanceof Discord.GroupDMChannel) {
        return 'Group DM'; // FIXME
    } else {
        return 'Unknown Channel';
    }
}

module.exports.handleMessage = function handleMessage(message) {
    var units = [];
    var match = unitSearchRegexp.exec(message.content);
    while (match) {
        if (unitAliases[match[1].toUpperCase()]) {
            units.push(unitAliases[match[1].toUpperCase()]);
        }
        match = unitSearchRegexp.exec(message.content);
    }
    units = filterIgnored(message.channel, Array.from(new Set(units)));
    if (units.length === 0) {
        return;
    }
    if (units.length > config.unit.max_per_message) {
        winston.debug('Too many units, ignoring message.');
        return;
    }
    updateIgnored(message.channel, units);

    winston.info(message.author.tag + ' (' + channelName(message.channel) + '):', 'Unit info:', units.join(', '));

    units.forEach(unit => {
        message.channel.send({ embed: createEmbed(unit, unitData[unit]) }).catch(e => {
                winston.error('Failed to send a message.', e);
            });
    });
};

const Discord = require('discord.js');
const fs = require('fs');
const winston = require('winston');

const config = require('./config');

const unitData = JSON.parse(fs.readFileSync('units.json'));
const unitAliases = collectUnitAliases();

const unitSearchRegexp = /\[\[([\w ]+)\]\]/g;

const channelIgnores = {};

function collectUnitAliases() {
    const aliases = {};

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

function createEmbed(unit) {
    const embed = new Discord.RichEmbed({
        image: {
            url: config.unit.image_url.replace('%NAME%', encodeURIComponent(unit.name)),
            width: 453,
            height: 217,
        },
    });
    embed.setColor('BLUE');
    embed.setTitle(unit.name);
    embed.setURL(config.unit.link_url.replace('%NAME%', encodeURIComponent(unit.name)));
    embed.setFooter(`Supply: ${unit.supply}`);
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
        return `${channel.guild.name} #${channel.name}`;
    } else if (channel instanceof Discord.DMChannel) {
        return 'DM';
    } else if (channel instanceof Discord.GroupDMChannel) {
        return 'Group DM'; // FIXME
    }
    return 'Unknown Channel';
}

function searchAll(content) {
    const units = [];
    const parts = content.split(' ');
    for (let i = 0; i < parts.length; i++) {
        let str = parts[i].toUpperCase();
        for (let j = 0; j < 3 && i + j < parts.length; j++) {
            if (j > 0) {
                str += ` ${parts[i + j].toUpperCase()}`;
            }
            if (unitAliases[str] && !units.includes(unitAliases[str])) {
                units.push(unitAliases[str]);
                break;
            }
        }
    }
    return units;
}

function searchTagged(content) {
    const units = [];
    let match = unitSearchRegexp.exec(content);
    while (match) {
        if (unitAliases[match[1].toUpperCase()] && !units.includes(unitAliases[match[1].toUpperCase()])) {
            units.push(unitAliases[match[1].toUpperCase()]);
        }
        match = unitSearchRegexp.exec(content);
    }
    return units;
}

module.exports.handleMessage = function handleMessage(message) {
    let units;

    if (message.channel instanceof Discord.DMChannel) {
        units = searchAll(message.content);
        if (units.length === 0) {
            units = searchTagged(message.content);
        }
    } else {
        units = filterIgnored(message.channel, searchTagged(message.content));
    }
    if (units.length === 0) {
        return;
    }
    if (units.length > config.unit.max_per_message) {
        winston.debug('Too many units, ignoring message.');
        return;
    }
    if (!(message.channel instanceof Discord.DMChannel)) {
        updateIgnored(message.channel, units);
    }

    winston.info(`${message.author.tag} (${channelName(message.channel)}):`, 'Unit info:', units.join(', '));

    units.forEach(unit => {
        message.channel.send({ embed: createEmbed(unitData[unit]) }).catch(e => {
            winston.error('Failed to send a message.', e);
        });
    });
};

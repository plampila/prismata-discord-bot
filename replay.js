const assert = require('assert');
const Discord = require('discord.js');
const fs = require('fs');
const http = require('http');
const PassThrough = require('stream').PassThrough;
const path = require('path');
const winston = require('winston');
const zlib = require('zlib');

const config = require('./config');

const codeRegexp = /^[a-zA-Z0-9@+]{5}-[a-zA-Z0-9@+]{5}$/;
const suspiciousCodeRegExp = /^[a-zA-Z][a-z]{4}-[a-zA-Z][a-z]{4}$/;
const codeSearchRegexp = /(?:^|[\s\(]|(?:[\?\&]r=))([a-zA-Z0-9@+]{5}-[a-zA-Z0-9@+]{5})(?:[\s,\.\)]|\&\w+|$)/g;
const gameTypeFormats = {
    200: 'Ranked',
    201: 'Versus',
    203: 'Event',
    204: 'Casual',
};
const romanNumeral = [null, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const errorMessage = {
    'NetworkError': 'Failed to fetch replay data.',
    'NotFound': 'Replay data not found.',
    'InvalidData': 'Failed to parse replay data.',
};

var channelIgnoredCodes = {};

function loadCachedData(code) {
    assert(code.match(codeRegexp));

    return new Promise((resolve, reject) => {
        var readData = '';
        fs.createReadStream(path.join(config.replay.cache_directory, code + '.json.gz'))
            .on('error', e => {
                reject(e);
            })
        .pipe(zlib.createGunzip())
            .on('data', data => {
                readData += data;
            })
            .on('end', () => {
                try {
                    resolve(JSON.parse(readData));
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', e => {
                reject(e);
            });
    });
}

function getData(code) {
    assert(code.match(codeRegexp));

    return new Promise((resolve, reject) => {
        loadCachedData(code).then(data => {
            resolve(data);
        }).catch(e => {
            winston.info('Downloading replay data: ' + code);
            var request = http.get(config.replay.data_url.replace('%CODE%', encodeURIComponent(code)), response => {
                if (!response || !response.statusCode) {
                    reject({ type: 'NetworkError', message: 'No response object.' });
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    if (response.statusCode === 404) {
                        reject({ type: 'NotFound', message: 'Unexpected HTTP status code: ' + response.statusCode });
                    } else {
                        reject({ type: 'NetworkError', message: 'Unexpected HTTP status code: ' + response.statusCode });
                    }
                    return;
                }

                var passThrough = PassThrough();
                response.pipe(passThrough);

                var readData = '';
                response.pipe(zlib.createGunzip())
                    .on('data', data => {
                        readData += data;
                    })
                    .on('end', () => {
                        try {
                            resolve(JSON.parse(readData));
                        } catch (e) {
                            reject({ type: 'InvalidData', message: e });
                            return;
                        }

                        var out = fs.createWriteStream(path.join(config.replay.cache_directory, code + '.json.gz'))
                        .on('close', () => {
                            winston.debug('Replay saved to cache: ' + code);
                        })
                        .on('error', (e) => {
                            winston.error('Failed to save replay data to cache.', e);
                        });
                        passThrough.pipe(out);
                    })
                    .on('error', (e) => {
                        reject({ type: 'InvalidData', message: e });
                    });
            })
            .on('error', (e) => {
                reject({ type: 'NetworkError', message: e });
            });
        });
    });
}

function extractTimeControl(data) {
    if (data.timeInfo.useClocks === false) {
        return 0;
    }

    var time = data.timeInfo.playerTime[data.playerInfo[0].bot ? 1 : 0].initial;
    if (time === 1000000) {
        return 0;
    }

    for (var i = 0; i < 2; i++) {
        if (data.playerInfo[i].bot) {
            continue;
        }
        if (data.timeInfo.playerTime[i].initial !== time ||
            data.timeInfo.playerTime[i].bank !== time ||
            data.timeInfo.playerTime[i].increment !== time) {
            return null;
        }
    }

    return time;
}

function formatRating(tier, tierPercent, rating) {
    if (tier >= 10) {
        return Math.round(rating);
    } else if (tier < 1 || tier === 1 && tierPercent === 0) {
        return '-';
    } else {
        return 'Tier ' + romanNumeral[tier] + ', ' + Math.floor(tierPercent * 100) + '%';
    }
}

function extractGameData(data) {
    try {
        return {
            p1: {
                name: data.playerInfo[0].displayName,
                rating: formatRating(data.ratingInfo.initialRatings[0].tier,
                    data.ratingInfo.initialRatings[0].tierPercent,
                    data.ratingInfo.initialRatings[0].displayRating),
            },
            p2: {
                name: data.playerInfo[1].displayName,
                rating: formatRating(data.ratingInfo.initialRatings[1].tier,
                    data.ratingInfo.initialRatings[1].tierPercent,
                    data.ratingInfo.initialRatings[1].displayRating),
            },
            gameType: gameTypeFormats.hasOwnProperty(data.format) ? gameTypeFormats[data.format] : 'Unknown',
            timeControl: extractTimeControl(data),
            hasBaseSet: data.deckInfo.base[0].length > 0,
            randomUnits: data.deckInfo.randomizer[0],
            startTime: new Date(data.startTime * 1000),
        };
    } catch (e) {
        winston.error('Failed to parse replay data.', e);
        return null;
    }
}

function createEmbed(code, data, errorMessage) {
    assert(code.match(codeRegexp));

    var embed = new Discord.RichEmbed();
    embed.setColor('BLUE');
    embed.setTitle(code);
    embed.setURL(config.replay.link_url.replace('%CODE%', code));
    if (errorMessage) {
        embed.setDescription(errorMessage);
    } else if (!data) {
        embed.setDescription('...');
    } else {
        var d = extractGameData(data);
        if (!d) {
            embed.setDescription('Failed to parse replay data.');
        } else {
            embed.addField(d.p1.name, d.p1.rating, true);
            embed.addField(d.p2.name, d.p2.rating, true);
            var desc = d.gameType;
            if (d.timeControl === 0) {
                desc += ', No Timelimit';
            } else if (d.timeControl > 0) {
                desc += ', ' + d.timeControl + 's';
            } else {
                desc += ', Custom Timelimit';
            }
            if (!d.hasBaseSet) {
                desc += ', Custom Set';
            } else {
                if(d.randomUnits.length === 0) {
                    desc += ', Base Set Only';
                } else {
                    desc += ', Base+' + d.randomUnits.length;
                }
            }
            embed.addField(desc, d.randomUnits.join(', '));
            embed.setFooter(d.startTime.toISOString().replace('T', ' ').replace(/:\d\d\..+/, ''));
        }
    }
    return embed;
}

function filterIgnored(channel, codes) {
    const cutoffTime = Date.now() - config.replay.ignore_duplicate_time * 1000;

    if (!channelIgnoredCodes.hasOwnProperty(channel)) {
        channelIgnoredCodes[channel] = {};
    }
    Object.keys(channelIgnoredCodes[channel]).forEach(code => {
        if (channelIgnoredCodes[channel][code] < cutoffTime) {
            delete channelIgnoredCodes[channel][code];
        }
    });

    return codes.filter(code => {
        return !channelIgnoredCodes[channel].hasOwnProperty(code);
    });
}

function updateIgnored(channel, codes) {
    const time = Date.now();

    if (!channelIgnoredCodes.hasOwnProperty(channel)) {
        channelIgnoredCodes[channel] = {};
    }
    codes.forEach(code => {
        channelIgnoredCodes[channel][code] = time;
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
    function hasIgnoredWord(text) {
        return config.replay.ignored_words.some(x => text.indexOf(x) !== -1);
    }

    var codes = [];
    var match = codeSearchRegexp.exec(message.content);
    while (match) {
        if (!codes.includes(match[1]) && !hasIgnoredWord(match[1])) {
            codes.push(match[1]);
        }
        codeSearchRegexp.lastIndex--;
        match = codeSearchRegexp.exec(message.content);
    }

    if (!(message.channel instanceof Discord.DMChannel)) {
        codes = filterIgnored(message.channel, codes);
    }
    if (codes.length === 0) {
        return;
    }
    if (codes.length > config.replay.max_per_message) {
        winston.debug('Too many replay codes, ignoring message.');
        return;
    }
    if (!(message.channel instanceof Discord.DMChannel)) {
        updateIgnored(message.channel, codes);
    }

    winston.info(message.author.tag + ' (' + channelName(message.channel) + '):', 'Replay codes:', codes.join(', '));

    codes.forEach(code => {
        const dataPromise = getData(code);

        message.channel.send({ embed: createEmbed(code, null) })
            .then(sentMessage => {
                dataPromise
                    .then(data => {
                        sentMessage.edit({ embed: createEmbed(code, data) }).catch(e => {
                            winston.error('Failed to edit message.', e);
                        });
                    })
                    .catch(e => {
                        if (e.type) {
                            winston.error('Failed to get replay data (' + code + '), ' + e.type + ':', e.message);
                            if (code.match(suspiciousCodeRegExp) && e.type === 'NotFound') {
                                winston.info('Hiding reply to suspicious code: ' + code);
                                sentMessage.delete().catch(e => {
                                    winston.error('Failed to delete message.', e);
                                });
                            } else {
                                sentMessage.edit({ embed: createEmbed(code, null,
                                    errorMessage[e.type] ? errorMessage[e.type] : 'Unknown Error') }).catch(e => {
                                        winston.error('Failed to edit message.', e);
                                    });
                            }
                        } else {
                            winston.error('Failed to get replay data (' + code + '):', e);
                            sentMessage.edit({ embed: createEmbed(code, null, 'Unknown Error') }).catch(e => {
                                winston.error('Failed to edit message.', e);
                            });
                        }
                    });
            })
            .catch(winston.error);
    });
};

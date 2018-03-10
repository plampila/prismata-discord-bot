const Discord = require('discord.js');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const PassThrough = require('stream').PassThrough;
const winston = require('winston');

const cacheDirectory = 'replays';
const dataUrl = 'http://saved-games-alpha.s3-website-us-east-1.amazonaws.com/';
const playUrl = 'https://play.prismata.net/?r=';
const codeRegexp = /(?:^|\s)[a-zA-Z0-9@+]{5}-[a-zA-Z0-9@+]{5}(?:\s|$)/g;
const gameTypeFormats = {
    200: "Ranked",
    201: "Versus",
    203: "Event",
    204: "Casual",
};
const romanNumeral = [null, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IIX', 'IX'];

const errorMessage = {
    'NetworkError': 'Failed to fetch replay data.',
    'NotFound': 'Replay data not found.',
    'InvalidData': 'Failed to parse replay data.',
};

function loadCachedData(code) {
    return new Promise(function (resolve, reject) {
        var readData = '';
        fs.createReadStream(path.join(cacheDirectory, code + '.json.gz'))
            .on('error', function (e) {
                reject(e);
            })
        .pipe(zlib.createGunzip())
            .on('data', function (data) {
                readData += data;
            })
            .on('end', function () {
                try {
                    resolve(JSON.parse(readData));
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', function (e) {
                reject(e);
            });
    });
}

function getData(code) {
    return new Promise(function (resolve, reject) {
        loadCachedData(code).then(function (data) {
            resolve(data);
        }).catch(function (e) {
            winston.info('Downloading replay data: ' + code);
            var request = http.get(dataUrl + code + '.json.gz', function (response) {
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
                    .on('data', function (data) {
                        readData += data;
                    })
                    .on('end', function () {
                        try {
                            resolve(JSON.parse(readData));
                        } catch (e) {
                            reject({ type: 'InvalidData', message: e });
                            return;
                        }

                        var out = fs.createWriteStream(path.join(cacheDirectory, code + '.json.gz'))
                        .on('close', function () {
                            winston.debug('Replay saved to cache: ' + code);
                        })
                        .on('error', function (e) {
                            winston.error('Failed to save replay data to cache.', e);
                        });
                        passThrough.pipe(out);
                    })
                    .on('error', function (e) {
                        reject({ type: 'InvalidData', message: e });
                    });
            })
            .on('error', function (e) {
                reject({ type: 'NetworkError', message: e });
            });
        });
    });
}

function extractTimeControl(data) {
    if (data.timeInfo.useClocks === false) {
        return 0;
    }

    var time = data.timeInfo.playerTime[0].initial;

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
        return 'Tier ' + romanNumeral[tier];
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
            gameType: gameTypeFormats.hasOwnProperty(data.format) ? gameTypeFormats[data.format] : "Unknown",
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
    var embed = new Discord.RichEmbed();
    embed.setColor('BLUE');
    embed.setTitle(code);
    embed.setURL(playUrl + code);
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
            embed.setFooter(d.startTime.toISOString().replace('T', ' ').replace('\..+', ''));
        }
    }
    return embed;
}

module.exports.handleMessage = function handleMessage(message) {
    var matches = message.content.match(codeRegexp);
    if (!matches) {
        return;
    }
    if (matches.length > 1) {
        winston.debug('Too many replay codes, ignoring message.');
        return;
    }

    const code = matches[0].trim();

    const dataPromise = getData(code);

    message.channel.send({ embed: createEmbed(code, null) })
        .then(function (message) {
            dataPromise
                .then(function (data) {
                    message.edit({ embed: createEmbed(code, data) });
                })
                .catch(function (e) {
                    winston.error("Failed to get replay data (" + code + "), " + e.type + ":", e.message);
                    message.edit({ embed: createEmbed(code, null,
                        errorMessage[e.type] ? errorMessage[e.type] : "Unknown Error") });
                });
        })
        .catch(winston.error);
};

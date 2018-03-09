const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const PassThrough = require('stream').PassThrough;
const winston = require('winston');

const cacheDirectory = 'replays';
const dataUrl = 'http://saved-games-alpha.s3-website-us-east-1.amazonaws.com/';
const codeRegexp = /[a-zA-Z0-9@+]{5}-[a-zA-Z0-9@+]{5}/g;

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
                    reject('Failed to fetch replay data. No response object.');
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject('Unexpected HTTP status code: ' + response.statusCode);
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
                            reject(e);
                            return;
                        }

                        var out = fs.createWriteStream(path.join(cacheDirectory, code + '.json.gz'))
                        .on('open', function () {
                            winston.debug('Opened.');
                        })
                        .on('close', function () {
                            winston.debug('Replay saved to cache: ' + code);
                        })
                        .on('error', function (e) {
                            winston.error('Failed to save replay data to cache.', e);
                        });
                        passThrough.pipe(out);
                    })
                    .on('error', function (e) {
                        reject(e);
                    });
            })
            .on('error', function (e) {
                reject('Failed to fetch replay data: ' + e);
            });
        });
    });
}

module.exports.handleMessage = function handleMessage(message) {
    var matches = message.content.match(codeRegexp);
    if (!matches) {
        return;
    }

    message.reply('Found ' + matches.length + ' replay codes.');
};

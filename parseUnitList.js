const fs = require('fs');

const unitSearchRegexp = /\['([\w ]+)',(\d+)]/g;

const data = fs.readFileSync(process.stdin.fd);

var units = {};
var match = unitSearchRegexp.exec(data);
while (match) {
    units[match[1]] = parseInt(match[2]);
    match = unitSearchRegexp.exec(data);
}

if (Object.keys(units).length < 100) {
    console.error('Error: Not enough units found.');
    process.exit(1);
}
console.log(JSON.stringify(units));

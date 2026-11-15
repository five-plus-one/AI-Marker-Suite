'use strict';
const fs = require('node:fs');
function patchReadiness(source) {
  const previous = "        for (let count = 0; count < 200 && !fs.existsSync(activePort); count++) await pause(100);\n" +
    "        if (!fs.existsSync(activePort)) throw Error('Chrome debugging endpoint unavailable');\n" +
    "        const [port, browserPath] = fs.readFileSync(activePort, 'utf8').trim().split(/\\r?\\n/);";
  if (!source.includes(previous)) return source;
  const next = "        let endpoint;\n" +
    "        for (let count = 0; count < 200; count++) {\n" +
    "            if (fs.existsSync(activePort)) {\n" +
    "                const fields = fs.readFileSync(activePort, 'utf8').trim().split(/\\r?\\n/);\n" +
    "                if (/^[1-9]\\d*$/.test(fields[0]) && Number(fields[0]) <= 65535 && /^\\/devtools\\/browser\\/[^\\s]+$/.test(fields[1] || '')) { endpoint = fields; break; }\n" +
    "            }\n" +
    "            await pause(100);\n" +
    "        }\n" +
    "        if (!endpoint) throw Error('Chrome debugging endpoint unavailable');\n" +
    "        const [port, browserPath] = endpoint;";
  return source.replace(previous,next);
}
function prepareBrowser(file) {
  const source = fs.readFileSync(file,'utf8');
  const updated = patchReadiness(source);
  if (updated !== source) fs.writeFileSync(file,updated);
  return updated;
}
module.exports = {patchReadiness,prepareBrowser};

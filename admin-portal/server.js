const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) filePath = path.join(DIR, 'index.html');

  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { res.statusCode = 500; res.end('Internal Server Error'); });
  stream.pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let lanIp = 'localhost';
  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) { lanIp = iface.address; break; }
  }
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   LIFC SuperAdmin Portal is running!    ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  This PC :  http://localhost:${PORT}        ║`);
  console.log(`  ║  Network :  http://${lanIp}:${PORT}   ║`);
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  Open on phone: scan QR or type the URL  ║');
  console.log('  ║  Press Ctrl+C to stop                    ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
});

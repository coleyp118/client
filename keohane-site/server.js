const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const root = __dirname;
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
http.createServer((req,res)=>{
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(root, pathname);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Cache-Control':'public, max-age=300'});
    res.end(data);
  });
}).listen(port,'0.0.0.0',()=>console.log(`Keohane site listening on ${port}`));

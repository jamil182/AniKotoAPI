// Isolated loopback entry point. Dependencies resolve from the parent application.
const express = require('express');
const routes = require('./src/routes/apiRoutes');
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({success: true, service: 'aniyear-miruro', version: '2.3.3'}));
app.use('/api', routes((res, results, status = 200) => res.status(status).json({success: true, results}),
  (res, message = 'Miruro request failed', status = 502) => {
    if (/\b429\b/.test(message)) return res.status(429).set('Retry-After','60').json({success:false,message:'Metadata source rate limit reached'});
    return res.status(status).json({success: false, message});
  }, Date.now()));
app.use((_req, res) => res.status(404).json({success: false, message: 'Not found'}));
const port = Number(process.env.MIRURO_PORT || 4466);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4444, 4455].includes(port)) throw new Error('Invalid isolated Miruro port');
const server = app.listen(port, '127.0.0.1');
server.on('error', error => { process.stderr.write(`Miruro service: ${error.code || 'startup error'}\n`); process.exitCode = 1; });
process.on('message', message => { if (message === 'shutdown') server.close(() => process.exit(0)); });
process.on('disconnect', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

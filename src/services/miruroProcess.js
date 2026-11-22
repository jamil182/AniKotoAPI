import { fork } from 'node:child_process';

/** Start only Aniyear's private provider service; never touch the independent API on 4444. */
export function startMiruroService() {
  let child, stopping = false, timer;
  const launch = () => {
    child = fork(new URL('../../services/miruro-api/server.cjs', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { NODE_ENV: 'production', MIRURO_PORT: process.env.MIRURO_PORT || '4466', PATH: process.env.PATH || '' },
    });
    child.on('error', () => process.stderr.write('Miruro service could not start.\n'));
    child.on('exit', () => { if (!stopping) { timer = setTimeout(launch, 5000); timer.unref(); } });
  };
  launch();
  process.once('exit', () => { stopping = true; clearTimeout(timer); child?.kill(); });
  return () => { stopping = true; clearTimeout(timer); child?.kill(); };
}

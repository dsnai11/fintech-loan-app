import cluster from 'cluster';
import os from 'os';

// Entry point. With WEB_CONCURRENCY=N (N > 1) it starts N copies of the server so a many-core machine is fully used;
// otherwise it just starts the server. Background jobs are safe with several copies: each job takes a lock first
// (see services/jobRunner.js), so it runs once, not once per copy.
const want = Number(process.env.WEB_CONCURRENCY) || 1;
const workers = Math.min(want, Math.max(1, os.cpus().length * 2), 16);

if (workers > 1 && cluster.isPrimary) {
  console.log(`Starting ${workers} server processes`);
  for (let i = 0; i < workers; i++) cluster.fork();
  let stopping = false;
  cluster.on('exit', (w, code) => {
    if (stopping) return;
    console.error(`Server process ${w.process.pid} stopped (code ${code}); starting another`);
    setTimeout(() => cluster.fork(), 1000);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers)) w?.process.kill('SIGTERM');
      setTimeout(() => process.exit(0), 10000).unref();
    });
  }
} else {
  await import('./app.js');
}

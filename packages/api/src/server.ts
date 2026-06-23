import { automationEnabled, env } from './config/env.js';
import { initAutomationScheduler } from './modules/automation/scheduler.js';
import app from './app.js';

/**
 * Asnova Payroll API — local/VPS Express server entrypoint.
 * Vercel imports the app through api/index.ts and must not call listen().
 */

app.listen(env.PORT, () => {
  console.log(`
  ┌──────────────────────────────────────────┐
  │  🚀 Asnova Payroll API                  │
  │  Port: ${String(env.PORT).padEnd(33)}│
  │  Env:  ${env.NODE_ENV.padEnd(33)}│
  │  Time: ${new Date().toISOString().padEnd(33)}│
  └──────────────────────────────────────────┘
  `);

  if (automationEnabled) {
    initAutomationScheduler();
  } else {
    console.log('  │  Automation: disabled for this runtime      │');
  }
});

export default app;

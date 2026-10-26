import cron from 'node-cron';
import { runMovieAutomation, getAutomationStatus } from '../services/movieAutomation.js';
import prisma from '../prisma/client.js';

// Default schedule: Every 12 hours (00:00 and 12:00)
// Configurable via MOVIE_SYNC_CRON environment variable
const DEFAULT_CRON_SCHEDULE = process.env.MOVIE_SYNC_CRON || '0 */12 * * *';

let scheduledTask = null;
let cronSchedule = DEFAULT_CRON_SCHEDULE;
let isInitialized = false;

/**
 * 4. SCHEDULE TASK (node-cron):
 * Automatically runs the movie fetching & link extraction automation
 * every 12 hours to keep the database updated with fresh movies and qualities.
 *
 * @param {object} options
 * @param {string} [options.schedule] - Custom cron schedule expression (default: '0 * /12 * * *')
 * @param {boolean} [options.runImmediately=false] - If true, triggers an initial sync right away
 */
export function startMovieCron({ schedule = DEFAULT_CRON_SCHEDULE, runImmediately = false } = {}) {
  cronSchedule = schedule;

  if (scheduledTask) {
    console.log(`[MOVIE_CRON] Stopping previous cron job...`);
    scheduledTask.stop();
    scheduledTask = null;
  }

  // Validate cron schedule format
  if (!cron.validate(cronSchedule)) {
    console.error(`[MOVIE_CRON] Invalid cron expression: "${cronSchedule}". Reverting to default: "0 */12 * * *"`);
    cronSchedule = '0 */12 * * *';
  }

  console.log(`[MOVIE_CRON] Initializing Movie Automation Cron with schedule: "${cronSchedule}" (every 12 hours)`);

  // Schedule cron job
  scheduledTask = cron.schedule(cronSchedule, async () => {
    console.log(`\n[MOVIE_CRON] ⏰ Scheduled 12-hour trigger fired at ${new Date().toISOString()}`);
    try {
      await runMovieAutomation({ limit: 50, page: 1, sortBy: 'date_added' });
    } catch (err) {
      console.error('[MOVIE_CRON] Error during scheduled sync execution:', err.message);
    }
  });

  isInitialized = true;

  // Check if an immediate sync should run (or if database has 0 links)
  if (runImmediately) {
    console.log('[MOVIE_CRON] "runImmediately" requested — initiating background sync in 3 seconds...');
    setTimeout(async () => {
      try {
        await runMovieAutomation({ limit: 20, page: 1 });
      } catch (e) {
        console.error('[MOVIE_CRON] Immediate sync error:', e.message);
      }
    }, 3000);
  } else {
    // Check if database has 0 links; if empty, run an initial seeding sync
    setTimeout(async () => {
      try {
        const linkCount = await prisma.downloadLink.count().catch(() => 0);
        if (linkCount === 0) {
          console.log('[MOVIE_CRON] Detected 0 download links in database. Running initial population sync...');
          await runMovieAutomation({ limit: 20, page: 1 });
        }
      } catch (checkErr) {
        console.warn('[MOVIE_CRON] Initial link count check skipped:', checkErr.message);
      }
    }, 5000);
  }

  console.log(`[MOVIE_CRON] ✓ Scheduled task active: runs automatically every 12 hours.`);
  return scheduledTask;
}

/**
 * Stop the scheduled cron job
 */
export function stopMovieCron() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    isInitialized = false;
    console.log('[MOVIE_CRON] Scheduled task stopped.');
  }
}

/**
 * Query current cron status and last sync metrics
 */
export function getMovieCronStatus() {
  return {
    isInitialized,
    cronSchedule,
    isActive: scheduledTask !== null,
    automation: getAutomationStatus()
  };
}

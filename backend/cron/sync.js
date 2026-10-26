#!/usr/bin/env node

/**
 * Standalone CLI runner for Movie Automation Sync
 * Usage:
 *   node cron/sync.js
 *   npm run sync:movies
 */

import { runMovieAutomation } from '../services/movieAutomation.js';
import prisma from '../prisma/client.js';

console.log('--- Zenemozite Movie & Direct Links Sync CLI ---');

async function main() {
  const startTime = Date.now();
  try {
    const limit = parseInt(process.env.SYNC_LIMIT, 10) || 50;
    const page = parseInt(process.env.SYNC_PAGE, 10) || 1;

    console.log(`Starting sync (limit: ${limit}, page: ${page})...`);
    const result = await runMovieAutomation({ limit, page });

    console.log('\n--- Sync Results Summary ---');
    console.log(`Status:            ${result.status}`);
    console.log(`Source Used:       ${result.sourceUsed}`);
    console.log(`Movies Processed:  ${result.moviesProcessed}`);
    console.log(`Movies Saved:      ${result.moviesSaved}`);
    console.log(`Links Created:     ${result.linksSaved}`);
    console.log(`Duration:          ${result.durationMs}ms`);

    if (result.errors && result.errors.length > 0) {
      console.log(`Errors Encountered: ${result.errors.length}`);
      result.errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.title || 'Global'}: ${err.error || err.global}`);
      });
    }

    const totalMovies = await prisma.movie.count();
    const totalLinks = await prisma.downloadLink.count();
    console.log(`\nDatabase Totals: ${totalMovies} movies, ${totalLinks} download links`);

  } catch (err) {
    console.error('Fatal CLI sync error:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    console.log(`Completed in ${Date.now() - startTime}ms.`);
  }
}

main();

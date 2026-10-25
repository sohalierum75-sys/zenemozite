import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'moviestream.db').replace(/\\/g, '/');

// Use environment DATABASE_URL in production/Docker, or resolve to exact absolute sqlite path
const dbUrl = (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('./prisma/moviestream.db'))
  ? process.env.DATABASE_URL
  : `file:${dbPath}`;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
  log: ['error', 'warn'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

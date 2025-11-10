import { neon } from '@neondatabase/serverless';

const DB_URL = process.env.DATABASE_URL ?? process.env.NEON_UI_tests;
if (!DB_URL) throw new Error('Missing env DATABASE_URL (or NEON_UI_tests)');

export const sql = neon(DB_URL);
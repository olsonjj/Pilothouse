import type { Config } from 'drizzle-kit'

export default {
  dialect: 'sqlite',
  schema: './src/server/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.PILOTHOUSE_DB_PATH ?? 'data/pilothouse.db' },
} satisfies Config
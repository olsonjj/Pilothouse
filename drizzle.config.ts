import type { Config } from 'drizzle-kit'

export default {
  dialect: 'sqlite',
  schema: './src/server/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.OPENEOS_DB_PATH ?? 'data/openeos.db' },
} satisfies Config
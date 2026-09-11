import type { Config } from 'drizzle-kit'

export default {
  dialect: 'sqlite',
  schema: './src/server/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.BOARDROOM_DB_PATH ?? 'data/boardroom.db' },
} satisfies Config
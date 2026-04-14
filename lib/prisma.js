import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:2580@localhost:5432/Chacha_KSD_localfede",
    },
  },
  log: ['error'],
})
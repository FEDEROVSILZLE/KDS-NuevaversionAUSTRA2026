import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Sector',
      credentials: {
        sector_code: { label: 'Sector', type: 'text' },
        password: { label: 'Clave', type: 'password' }
      },
      async authorize(credentials) {
        console.log('LOGIN ATTEMPT:', credentials)
        if (!credentials?.sector_code || !credentials?.password) return null

        const allUsers = await prisma.$queryRaw`SELECT sector_code FROM public.sector_users`
        console.log('ALL USERS:', allUsers)

        const users = await prisma.$queryRaw`
          SELECT * FROM public.sector_users 
          WHERE sector_code = ${credentials.sector_code}
          AND is_active = true
          LIMIT 1
        `

        console.log('USERS FOUND:', users)

        if (!users || users.length === 0) return null

        const isValid = await bcrypt.compare(credentials.password, users[0].password_hash)
        console.log('IS VALID:', isValid)

        if (!isValid) return null

        return {
          id: users[0].id.toString(),
          name: users[0].sector_name,
          sector: users[0].sector_code,
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sector = user.sector
      return token
    },
    async session({ session, token }) {
      session.user.sector = token.sector
      return session
    }
  },
  pages: {
    signIn: '/',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
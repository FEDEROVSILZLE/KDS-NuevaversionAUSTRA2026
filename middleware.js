export { default } from 'next-auth/middleware'

export const config = {
  matcher: [
    '/cocina/:path*',
    '/armado/:path*',
    '/deposito/:path*',
    '/remitos/:path*',
    '/sucursales/:path*',
    '/fabrica/:path*',
    '/admin/:path*',
  ]
}
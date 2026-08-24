import type { NextConfig } from 'next'

const config: NextConfig = {
  // Prisma loads a native query engine at run time, which a bundler cannot inline.
  serverExternalPackages: ['@prisma/client'],
}

export default config

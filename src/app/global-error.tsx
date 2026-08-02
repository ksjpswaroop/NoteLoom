'use client'

import { ErrorRecovery } from '@/components/error-recovery'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body>
        <ErrorRecovery error={error} reset={reset} />
      </body>
    </html>
  )
}

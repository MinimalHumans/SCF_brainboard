import React from 'react'
import { createPortal } from 'react-dom'
import { useToastStore } from '@/store/toastStore'
import styles from './Toast.module.css'

/*
 * ToastStack
 * ----------
 * Renders all current toasts in a fixed bottom-right stack.
 * Mount once in App.tsx — it self-manages via the toastStore.
 */
export function ToastStack() {
  const { toasts, remove } = useToastStore()
  if (toasts.length === 0) return null

  return createPortal(
    <div className={styles.stack} aria-live="polite" aria-label="Notifications">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.kind]}`}
          role="status"
        >
          <span className={styles.icon}>{ICONS[t.kind]}</span>
          <span className={styles.message}>{t.message}</span>
          <button
            className={styles.dismiss}
            onClick={() => remove(t.id)}
            aria-label="Dismiss"
          >×</button>
        </div>
      ))}
    </div>,
    document.body
  )
}

const ICONS: Record<string, string> = {
  success: '✓',
  info:    'ℹ',
  warning: '⚠',
  error:   '✕',
}

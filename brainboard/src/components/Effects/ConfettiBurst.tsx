import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfettiBurstProps {
  onDone: () => void
}

const COLORS = ['#ef363a', '#f4af40', '#6bbe45', '#4f52d4', '#ece5da']
const PARTICLE_COUNT = 160
const DURATION_MS = 2200
const GRAVITY = 0.12

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rotation: number
  rotationSpeed: number
  shape: 'rect' | 'circle'
}

/*
 * ConfettiBurst — a one-shot full-screen particle burst, self-mounting via
 * portal and self-removing after DURATION_MS (calls onDone so the caller can
 * drop it from the tree). No canvas resize handling — the animation is short
 * enough that a mid-burst viewport resize is not worth the complexity.
 */
export function ConfettiBurst({ onDone }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const width  = window.innerWidth
    const height = window.innerHeight
    canvas.width  = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 160,
      y: -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      size: 4 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    }))

    let raf = 0
    const start = performance.now()

    const frame = (now: number) => {
      const elapsed = now - start
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        p.vy += GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6)
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
      if (elapsed < DURATION_MS) {
        raf = requestAnimationFrame(frame)
      } else {
        onDoneRef.current()
      }
    }
    raf = requestAnimationFrame(frame)

    return () => cancelAnimationFrame(raf)
  }, [])

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position:      'fixed',
        inset:         0,
        width:         '100vw',
        height:        '100vh',
        pointerEvents: 'none',
        zIndex:        1500,
      }}
    />,
    document.body,
  )
}
